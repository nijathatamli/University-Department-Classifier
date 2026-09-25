#!/usr/bin/env python3
"""
Inference service for the student-request router.

The trained pipeline is loaded once at start-up and reused for every request —
the model is never retrained during inference.

Run:  python3 ml/serve.py           (defaults to 127.0.0.1:8001)

Endpoints
    GET  /health   liveness + whether a model is loaded
    GET  /info     model version, algorithm, training date, evaluation metrics
    POST /predict  {"text": "..."} -> label, confidence, full probability list

This service is bound to localhost and is called only by the Node API, which
owns authentication. It is not exposed to the browser.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import joblib
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from train import normalise  # the exact cleaning used at training time

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
MODEL_FILE = MODELS / "classifier.joblib"
METRICS_FILE = MODELS / "metrics.json"

app = FastAPI(title="UDC Request Router", version="1.0.0")

_pipeline: Any = None
_metrics: dict = {}


def load_artifacts() -> None:
    """Loads the trained pipeline and its recorded metrics into memory."""
    global _pipeline, _metrics
    if not MODEL_FILE.exists():
        raise RuntimeError(
            f"No trained model at {MODEL_FILE}. Run `python3 ml/train.py` first."
        )
    _pipeline = joblib.load(MODEL_FILE)
    _metrics = json.loads(METRICS_FILE.read_text(encoding="utf-8")) if METRICS_FILE.exists() else {}


@app.on_event("startup")
def startup() -> None:
    load_artifacts()
    print(f"Loaded {MODEL_FILE.name} — labels: {list(_pipeline.classes_)}")


class PredictRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "modelLoaded": _pipeline is not None}


@app.get("/info")
def info() -> dict:
    if _pipeline is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {
        "modelVersion": _metrics.get("model_version", "unknown"),
        "algorithm": _metrics.get("algorithm", "TF-IDF + Logistic Regression"),
        "featureVersion": _metrics.get("feature_version", "v1"),
        "trainedAt": _metrics.get("trained_at"),
        "datasetSize": _metrics.get("dataset_size"),
        "trainSize": _metrics.get("train_size"),
        "testSize": _metrics.get("test_size"),
        "labels": list(_pipeline.classes_),
        "labelDistribution": _metrics.get("label_distribution", {}),
        "metrics": {
            "accuracy": _metrics.get("accuracy"),
            "precisionMacro": _metrics.get("precision_macro"),
            "recallMacro": _metrics.get("recall_macro"),
            "f1Macro": _metrics.get("f1_macro"),
            "cvAccuracyMean": _metrics.get("cv_accuracy_mean"),
            "cvAccuracyStd": _metrics.get("cv_accuracy_std"),
        },
        "perLabel": _metrics.get("per_label", {}),
        "confusionMatrix": _metrics.get("confusion_matrix", {}),
        "vocabularySize": _metrics.get("vocabulary_size"),
    }


@app.post("/predict")
def predict(payload: PredictRequest) -> dict:
    if _pipeline is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    cleaned = normalise(payload.text)
    if not cleaned:
        # Punctuation/emoji only: nothing for the vectoriser to work with.
        raise HTTPException(status_code=422, detail="Text contains no classifiable content")

    probabilities = _pipeline.predict_proba([cleaned])[0]
    classes = list(_pipeline.classes_)

    ranked = sorted(
        ({"label": label, "probability": round(float(p), 4)} for label, p in zip(classes, probabilities)),
        key=lambda item: item["probability"],
        reverse=True,
    )

    return {
        "label": ranked[0]["label"],
        # Confidence comes straight from the model's probability output.
        "confidence": ranked[0]["probability"],
        "probabilities": ranked,
        "modelVersion": _metrics.get("model_version", "unknown"),
    }


if __name__ == "__main__":
    load_artifacts()
    uvicorn.run(
        app,
        host=os.environ.get("ML_HOST", "127.0.0.1"),
        port=int(os.environ.get("ML_PORT", "8001")),
        log_level="warning",
    )
