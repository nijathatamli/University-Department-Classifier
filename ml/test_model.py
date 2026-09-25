#!/usr/bin/env python3
"""
Model tests.  Run:  python3 ml/test_model.py

Asserts the trained artifacts exist, that the canonical examples from the
product brief route correctly, and that probabilities are real (they sum to 1
and are not constant).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from train import normalise  # noqa: E402

CANONICAL = [
    ("Salam, təhsil haqqımın ödənişi ilə bağlı problem yaşayıram.", "Maliyyə"),
    ("Kitabxanadan götürdüyüm kitabı sistemdə qaytara bilmirəm.", "Kitabxana"),
    ("Wi-Fi işləmədiyi üçün universitet portalına daxil ola bilmirəm.", "İT Dəstək"),
    ("İmtahan nəticəmlə bağlı müraciət etmək istəyirəm.", "Dekanat"),
    # Short and informal, the way students actually type.
    ("Parolumu unutmuşam", "İT Dəstək"),
    ("Təqaüdüm gəlməyib", "Maliyyə"),
    ("Kitabı gecikdirmişəm cərimə var", "Kitabxana"),
    ("Diplomumu almaq istəyirəm", "Dekanat"),
    # Missing diacritics — a very common real-world case.
    ("pul kocurmusem gorunmur", "Maliyyə"),
    ("internet yoxdur", "İT Dəstək"),
]

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  ok   {message}")
    else:
        print(f"  FAIL {message}")
        failures.append(message)


def main() -> int:
    model_file = ROOT / "models" / "classifier.joblib"
    metrics_file = ROOT / "models" / "metrics.json"

    print("artifacts")
    check(model_file.exists(), "classifier.joblib exists")
    check(metrics_file.exists(), "metrics.json exists")
    if failures:
        print("\nRun `python3 ml/train.py` first.")
        return 1

    pipeline = joblib.load(model_file)
    metrics = json.loads(metrics_file.read_text(encoding="utf-8"))

    print("\nmetrics")
    check(metrics["dataset_size"] >= 100, f"dataset has {metrics['dataset_size']} samples (>= 100)")
    check(len(metrics["labels"]) == 4, "four labels")
    for key in ("accuracy", "precision_macro", "recall_macro", "f1_macro", "cv_accuracy_mean"):
        check(0.0 <= metrics[key] <= 1.0, f"{key} in range ({metrics[key]})")
    check(metrics["cv_accuracy_mean"] > 0.6,
          f"cross-validated accuracy above chance ({metrics['cv_accuracy_mean']})")
    matrix = metrics["confusion_matrix"]["matrix"]
    check(sum(sum(row) for row in matrix) == metrics["test_size"],
          "confusion matrix totals equal the test set size")

    print("\nrouting")
    correct = 0
    for text, expected in CANONICAL:
        predicted = pipeline.predict([normalise(text)])[0]
        ok = predicted == expected
        correct += ok
        print(f"  {'ok  ' if ok else 'FAIL'} {expected:<11} <- {text[:46]}"
              + ("" if ok else f"   (got {predicted})"))
        if not ok:
            failures.append(f"routing: {text}")

    print(f"\n  {correct}/{len(CANONICAL)} canonical examples")

    print("\nprobabilities")
    probs = pipeline.predict_proba([normalise(t) for t, _ in CANONICAL])
    check(all(abs(row.sum() - 1.0) < 1e-6 for row in probs), "each distribution sums to 1")
    check(len({round(float(row.max()), 4) for row in probs}) > 1,
          "confidence varies between inputs (not a constant)")
    check(all(row.max() > 0.25 for row in probs),
          "top probability always beats a uniform guess")

    # Determinism: the same text must always route the same way.
    repeat = pipeline.predict([normalise(CANONICAL[0][0])] * 3)
    check(len(set(repeat)) == 1, "identical input gives identical output")

    print()
    if failures:
        print(f"{len(failures)} failure(s)")
        return 1
    print("all model tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
