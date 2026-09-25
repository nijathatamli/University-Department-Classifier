# The classification model

## What it does

Takes a free-text student message in Azerbaijani and returns the department that should handle it,
with a probability for every department.

```
"Wi-Fi işləmədiyi üçün universitet portalına daxil ola bilmirəm."
   → İT Dəstək    89.6%
     Maliyyə       4.1%
     Dekanat       3.6%
     Kitabxana     2.7%
```

## Pipeline

```
dataset.json
     ↓  normalise()          lower-case, strip punctuation/digits, fold İ/I
  train/test split           stratified, 75/25, seed 42
     ↓
  TF-IDF                     char_wb n-grams (2–5), sublinear TF
     ↓
  Logistic Regression        C=6, class_weight="balanced", max_iter=3000
     ↓
  evaluation                 accuracy, precision, recall, F1, confusion matrix, 5-fold CV
     ↓
  refit on the FULL dataset  ← the artifact that ships
     ↓
  ml/models/classifier.joblib + metrics.json
```

Train with `npm run ml:train` (or `python3 ml/train.py`). It prints everything it measures.

## Why character n-grams

This is the single decision that makes the project work.

Azerbaijani is agglutinative — meaning is carried by suffixes stacked onto a root:

| Word | Root |
|---|---|
| kitab, kitabı, kitabdan, kitabxana, kitabxanadan, kitabxanaya | *kitab* |
| ödəniş, ödənişi, ödənişlə, ödəməliyəm, ödəmişəm | *ödə* |

A word-level vectoriser treats every one of those as a separate feature. With 151 training
sentences, a test sentence often shares **no** word tokens with anything in training, even when it
is obviously about the same topic.

Character n-grams match the shared substrings instead. Measured by 5-fold cross-validation on the
same data:

| Features | Model | CV accuracy |
|---|---|---|
| word (1,2) | Logistic Regression | 0.562 |
| word (1,2) | ComplementNB | 0.576 |
| **char_wb (2,5)** | **Logistic Regression** | **0.801** |
| char_wb (2,5) | ComplementNB | 0.788 |
| char_wb (2,4) | Logistic Regression | 0.794 |
| char_wb (3,5) | Logistic Regression | 0.768 |
| word + char union | Logistic Regression | 0.722 |

`char_wb` keeps n-grams inside word boundaries rather than spanning spaces.

A side benefit: the model tolerates the way students actually type. *"pul kocurmusem gorunmur"*
(no diacritics) and *"Kitabxandan"* (typo) both route correctly.

## Text normalisation

One subtlety worth knowing about. Azerbaijani has a dotted/dotless i pair, and Python's
`"İ".lower()` produces `i` **plus a combining dot above** (U+0307). Left alone, "İT Dəstək" and
"it" become different tokens. `normalise()` folds `İ→i` and `I→ı` before lower-casing and strips
any stray combining dot.

## The dataset

`ml/data/dataset.json` — 151 sentences, near-balanced:

| Label | Samples |
|---|---|
| Dekanat | 38 |
| Maliyyə | 38 |
| İT Dəstək | 38 |
| Kitabxana | 37 |

Written to resemble real student messages: formal requests and blunt one-liners, questions and
complaints, long and short, some with missing diacritics or typos on purpose.

## Evaluation

Measured on the held-out 25% (38 sentences) plus 5-fold cross-validation over all 151:

| Metric | Value |
|---|---|
| Hold-out accuracy | 0.789 |
| Macro precision | 0.829 |
| Macro recall | 0.786 |
| Macro F1 | 0.785 |
| **5-fold CV accuracy** | **0.801 ± 0.082** |

**The cross-validated number is the honest one.** A 38-sentence test set is small enough that a
single split swings by several points; CV averages over five.

Confusion matrix (rows = actual, columns = predicted):

|  | Dekanat | Kitabxana | Maliyyə | İT Dəstək |
|---|---|---|---|---|
| **Dekanat** | 8 | 0 | 1 | 0 |
| **Kitabxana** | 3 | 5 | 1 | 0 |
| **Maliyyə** | 1 | 0 | 8 | 1 |
| **İT Dəstək** | 1 | 0 | 0 | 9 |

Kitabxana is the weakest class — three of its messages were read as Dekanat. That is not
surprising: *"Kitabxana hesabıma daxil ola bilmirəm, parolu unutmuşam"* is genuinely close to both
an İT and a Dekanat request. More Kitabxana examples would be the first thing to add.

These numbers are written to `ml/models/metrics.json` by the training run and surfaced unchanged
at `/api/v1/model/info`, on `/how-it-works`, and in the admin console. **Nothing is hand-written.**

## Shipping artifact vs reported metrics

The evaluation uses a 75% train split. The model that actually ships is then **refit on all 151
sentences** — with a corpus this small, discarding a quarter of it in production measurably hurts.
The reported metrics stay the held-out ones, because those estimate generalisation; the shipped
model is strictly better than the one they describe.

The difference is visible: before refitting, *"Wi-Fi işləmədiyi üçün..."* scored 71.8%; after,
89.6%.

## Confidence

`confidence` is `predict_proba(...).max()` — the model's own output, rounded to four decimals and
stored on the prediction row. It is never assigned by hand and never adjusted after the fact.

The UI treats anything below 50% as low confidence: the student sees a warning that the department
may re-route, and the ticket appears in the admin console's low-confidence list.

## Serving

`ml/serve.py` (FastAPI) loads `classifier.joblib` **once at start-up**:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness and whether a model is loaded |
| `GET /info` | Version, algorithm, training date, full metrics |
| `POST /predict` | `{"text": "..."}` → label, confidence, all probabilities |

Bound to localhost. Only the Node API calls it; the browser never does. If it is down, the API
returns `CLASSIFIER_UNAVAILABLE` (503) and the classifier page says so before the student types.

## Retraining

```bash
# 1. add examples to ml/data/dataset.json
# 2. retrain and read the printed metrics
npm run ml:train
# 3. verify
python3 ml/test_model.py
# 4. restart the inference service so it loads the new artifact
npm run ml:serve
# 5. register the new version in the database
npm run db:seed
```

Each prediction stores the `model_version` that produced it, so old tickets stay explainable after
a retrain.

## Adding a department

1. Create it in the admin console (or insert into `departments`). The API answers
   `retrainingRequired: true` — the new department will receive **nothing** until step 2.
2. Add labelled examples for it to `ml/data/dataset.json` (aim for 30+, matching the other
   classes).
3. Retrain, test, restart the service.

Routing resolves the model's label to a department row by name, so the label in the dataset must
match the department's `name` exactly.

## Limitations

- **151 sentences is small.** Expect roughly one request in five to land on the wrong desk.
- **Kitabxana is the weakest class** (recall 0.56 on the hold-out split).
- **No out-of-scope class.** A message about something none of the four departments handle is
  still forced into one of them; confidence will usually be low, which is what the warning and the
  admin list are for.
- **Azerbaijani only.** A message written in English or Russian will be classified on character
  patterns that mean nothing to the model.
- **No fairness or robustness audit**, and no adversarial testing.

## Replacing the model

The Node API depends only on the three HTTP endpoints above. Any model that serves the same
contract — Naive Bayes, a linear SVM with calibrated probabilities, a fine-tuned transformer —
can replace this one without touching the API, the database or the frontend. Keep returning a real
probability distribution: the product shows it to students.
