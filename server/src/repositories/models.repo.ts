import { query } from '../db/pool.ts';

export interface MlModelRow {
  id: string;
  name: string;
  version: string;
  feature_version: string;
  algorithm: string;
  dataset_size: number | null;
  is_active: boolean;
  trained_at: Date | null;
  metrics: Record<string, unknown>;
  notes: string | null;
  created_at: Date;
}

export async function listModels(): Promise<MlModelRow[]> {
  const { rows } = await query<MlModelRow>(
    'SELECT * FROM ml_models ORDER BY is_active DESC, created_at DESC',
  );
  return rows;
}

export async function getActiveModel(): Promise<MlModelRow | null> {
  const { rows } = await query<MlModelRow>('SELECT * FROM ml_models WHERE is_active LIMIT 1');
  return rows[0] ?? null;
}

/** Deactivates every other model first — a partial-unique index enforces this too. */
export async function activateModel(version: string): Promise<MlModelRow | null> {
  await query('UPDATE ml_models SET is_active = false WHERE is_active');
  const { rows } = await query<MlModelRow>(
    'UPDATE ml_models SET is_active = true WHERE version = $1 RETURNING *', [version],
  );
  return rows[0] ?? null;
}

export { };
