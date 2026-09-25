import { env } from '../config/env.ts';
import { AppError } from './errors.ts';

/**
 * Thin HTTP client for the Python inference service (ml/serve.py).
 *
 * The model itself lives in Python because that is where scikit-learn is; this
 * process never loads or retrains it. The service is bound to localhost and is
 * never reachable from the browser — the Node API owns authentication.
 */

export interface Probability {
  label: string;
  probability: number;
}

export interface Prediction {
  label: string;
  confidence: number;
  probabilities: Probability[];
  modelVersion: string;
}

export interface ModelInfo {
  modelVersion: string;
  algorithm: string;
  featureVersion: string;
  trainedAt: string | null;
  datasetSize: number | null;
  trainSize: number | null;
  testSize: number | null;
  labels: string[];
  labelDistribution: Record<string, number>;
  metrics: Record<string, number | null>;
  perLabel: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  confusionMatrix: { labels?: string[]; matrix?: number[][] };
  vocabularySize: number | null;
}

const TIMEOUT_MS = 8000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${env.mlServiceUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });

    if (response.status === 422) {
      throw new AppError(422, 'UNPROCESSABLE',
        'The message does not contain enough text to classify.');
    }
    if (!response.ok) {
      throw new AppError(503, 'CLASSIFIER_UNAVAILABLE',
        'The classification service is not responding. Please try again shortly.');
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Connection refused, DNS failure or timeout: the service is down.
    throw new AppError(503, 'CLASSIFIER_UNAVAILABLE',
      'The classification service is not running. Start it with "npm run ml:serve".');
  } finally {
    clearTimeout(timer);
  }
}

export const classifyText = (text: string): Promise<Prediction> =>
  call<Prediction>('/predict', { method: 'POST', body: JSON.stringify({ text }) });

export const getModelInfo = (): Promise<ModelInfo> => call<ModelInfo>('/info');

export async function classifierHealthy(): Promise<boolean> {
  try {
    const health = await call<{ status: string; modelLoaded: boolean }>('/health');
    return health.status === 'ok' && health.modelLoaded;
  } catch {
    return false;
  }
}
