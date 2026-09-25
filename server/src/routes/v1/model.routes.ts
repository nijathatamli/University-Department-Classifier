import type { FastifyInstance } from 'fastify';
import { classifierHealthy, getModelInfo } from '../../lib/classifier-client.ts';
import { getActiveModel } from '../../repositories/models.repo.ts';

/**
 * Model transparency. Every number here comes from ml/train.py's evaluation on
 * a held-out split — nothing is hand-written.
 */
export default async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/info', async () => {
    const [live, registered] = await Promise.all([
      getModelInfo().catch(() => null),
      getActiveModel(),
    ]);

    // Prefer the live service (it is the model actually answering requests);
    // fall back to what was registered at seed time if it is unreachable.
    if (live) return { source: 'service', ...live };
    if (registered) {
      return {
        source: 'registry',
        modelVersion: registered.version,
        algorithm: registered.algorithm,
        featureVersion: registered.feature_version,
        trainedAt: registered.trained_at,
        datasetSize: registered.dataset_size,
        metrics: registered.metrics,
        available: false,
      };
    }
    return { source: 'none', available: false };
  });

  app.get('/health', async () => ({ classifierAvailable: await classifierHealthy() }));
}
