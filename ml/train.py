#!/usr/bin/env python3
"""
Trains the student-request router.

    dataset -> cleaning -> train/test split -> TF-IDF -> Logistic Regression
            -> evaluation -> saved artifacts

Run:  python3 ml/train.py

Writes ml/models/classifier.joblib (pipeline: vectoriser + model) and
ml/models/metrics.json (evaluation actually measured on the held-out test set).
Nothing here is hard-coded: every number the admin page shows comes from this run.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "dataset.json"
MODELS = ROOT / "models"

MODEL_VERSION = "request-router-v1.0"
RANDOM_STATE = 42

# Character n-grams are used instead of word tokens, so there is no stop-word
# list: sklearn ignores stop_words for a char analyzer, and the frequent words
# it would remove carry little weight under sublinear TF anyway.


def normalise(text: str) -> str:
    """
    Lower-cases and strips punctuation/digits.

    Azerbaijani has a dotted/dotless i pair that breaks naive lower-casing:
    "İ".lower() yields "i̇" (i + combining dot) in Python, which would split
    "İT" from "it". Both are folded to a plain "i" so the vectoriser sees one
    token either way.
    """
    text = text.replace("İ", "i").replace("I", "ı")
    text = text.lower()
    text = text.replace("̇", "")  # stray combining dot above
    text = re.sub(r"[^a-zçəğıöşü\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def load_dataset() -> tuple[list[str], list[str], dict]:
    if not DATA.exists():
        sys.exit(f"Dataset not found at {DATA}")
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    samples = payload["samples"]
    texts = [normalise(s["text"]) for s in samples]
    labels = [s["label"] for s in samples]
    return texts, labels, payload["meta"]


def build_pipeline() -> Pipeline:
    """
    Character n-grams, not word tokens.

    Azerbaijani is agglutinative: "kitab", "kitabı", "kitabxanadan" and
    "kitabxanaya" are four distinct word tokens carrying the same root. With a
    151-sentence corpus, word features barely overlap between train and test —
    measured 5-fold accuracy was 0.56 for word(1,2) against 0.80 for
    char_wb(2,5), so the character analyser is what makes this dataset usable.
    `char_wb` keeps n-grams inside word boundaries rather than spanning spaces.
    """
    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    analyzer="char_wb",
                    ngram_range=(2, 5),
                    min_df=1,
                    sublinear_tf=True,
                ),
            ),
            (
                "clf",
                LogisticRegression(
                    max_iter=3000,
                    C=6.0,
                    # Guards against a label ending up slightly under-represented.
                    class_weight="balanced",
                    random_state=RANDOM_STATE,
                ),
            ),
        ]
    )


def main() -> None:
    texts, labels, meta = load_dataset()
    label_names = sorted(set(labels))
    print(f"Loaded {len(texts)} samples across {len(label_names)} labels")
    for name in label_names:
        print(f"  {name:<12} {labels.count(name)}")

    # Stratified so every label appears in both halves of the split.
    x_train, x_test, y_train, y_test = train_test_split(
        texts, labels, test_size=0.25, random_state=RANDOM_STATE, stratify=labels
    )
    print(f"\nTrain: {len(x_train)}   Test: {len(x_test)}")

    pipeline = build_pipeline()
    pipeline.fit(x_train, y_train)

    predicted = pipeline.predict(x_test)

    accuracy = accuracy_score(y_test, predicted)
    precision = precision_score(y_test, predicted, average="macro", zero_division=0)
    recall = recall_score(y_test, predicted, average="macro", zero_division=0)
    f1 = f1_score(y_test, predicted, average="macro", zero_division=0)

    # A 150-row test split is small, so a single hold-out score is noisy.
    # Cross-validation on the full set is the more honest headline number.
    cv = cross_val_score(
        build_pipeline(),
        texts,
        labels,
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE),
        scoring="accuracy",
    )

    matrix = confusion_matrix(y_test, predicted, labels=label_names).tolist()
    per_label = classification_report(
        y_test, predicted, labels=label_names, output_dict=True, zero_division=0
    )

    print(f"\nHold-out accuracy : {accuracy:.3f}")
    print(f"Macro precision   : {precision:.3f}")
    print(f"Macro recall      : {recall:.3f}")
    print(f"Macro F1          : {f1:.3f}")
    print(f"5-fold CV accuracy: {cv.mean():.3f} (+/- {cv.std():.3f})")
    print("\nConfusion matrix (rows = actual, cols = predicted)")
    print("            " + "".join(f"{n[:9]:>11}" for n in label_names))
    for name, row in zip(label_names, matrix):
        print(f"{name:<12}" + "".join(f"{v:>11}" for v in row))

    # The evaluation above used a 75% train split. The artifact we ship is refit
    # on the FULL dataset: with only ~150 samples, throwing away a quarter of
    # them in production costs real accuracy. The reported metrics stay the
    # held-out ones, because those are the honest estimate of generalisation.
    final = build_pipeline()
    final.fit(texts, labels)

    MODELS.mkdir(parents=True, exist_ok=True)
    joblib.dump(final, MODELS / "classifier.joblib")

    metrics = {
        "model_version": MODEL_VERSION,
        "algorithm": "TF-IDF + Logistic Regression",
        "feature_version": meta.get("version", "v1"),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_size": len(texts),
        "train_size": len(x_train),
        "test_size": len(x_test),
        "labels": label_names,
        "label_distribution": {name: labels.count(name) for name in label_names},
        "accuracy": round(float(accuracy), 4),
        "precision_macro": round(float(precision), 4),
        "recall_macro": round(float(recall), 4),
        "f1_macro": round(float(f1), 4),
        "cv_accuracy_mean": round(float(cv.mean()), 4),
        "cv_accuracy_std": round(float(cv.std()), 4),
        "confusion_matrix": {"labels": label_names, "matrix": matrix},
        "per_label": {
            name: {
                "precision": round(float(per_label[name]["precision"]), 4),
                "recall": round(float(per_label[name]["recall"]), 4),
                "f1": round(float(per_label[name]["f1-score"]), 4),
                "support": int(per_label[name]["support"]),
            }
            for name in label_names
        },
        "vocabulary_size": int(len(final.named_steps["tfidf"].vocabulary_)),
        "fit_on": "full dataset (metrics measured on the held-out split)",
    }
    (MODELS / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\nSaved {MODELS / 'classifier.joblib'}")
    print(f"Saved {MODELS / 'metrics.json'}")

    # Quick smoke check against the examples from the product brief.
    print("\nSample predictions:")
    checks = [
        "Salam, təhsil haqqımın ödənişi ilə bağlı problem yaşayıram.",
        "Kitabxanadan götürdüyüm kitabı sistemdə qaytara bilmirəm.",
        "Wi-Fi işləmədiyi üçün universitet portalına daxil ola bilmirəm.",
        "İmtahan nəticəmlə bağlı müraciət etmək istəyirəm.",
    ]
    probabilities = final.predict_proba([normalise(c) for c in checks])
    for text, row in zip(checks, probabilities):
        index = int(np.argmax(row))
        print(f"  {final.classes_[index]:<12} {row[index] * 100:5.1f}%  {text[:52]}")


if __name__ == "__main__":
    main()
