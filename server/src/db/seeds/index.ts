import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withTransaction } from '../pool.ts';
import { hashPassword } from '../../auth/password.ts';

/**
 * Seeds the four routing departments, their staff accounts, and registers the
 * trained model. Idempotent: every insert upserts on a natural key.
 */

const DEPARTMENTS: Array<{ name: string; slug: string; description: string; email: string }> = [
  {
    name: 'Dekanat',
    slug: 'dekanat',
    description:
      'Təhsil prosesi: imtahan nəticələri, transkript, dərs cədvəli, qeydiyyat, akademik məzuniyyət, diplom və arayışlar.',
    email: 'dekanat@universitet.edu.az',
  },
  {
    name: 'Maliyyə',
    slug: 'maliyye',
    description:
      'Təhsil haqqı, ödənişlər, təqaüd, qaytarmalar, güzəştlər və maliyyə sənədləri.',
    email: 'maliyye@universitet.edu.az',
  },
  {
    name: 'Kitabxana',
    slug: 'kitabxana',
    description:
      'Kitab götürmə və qaytarma, cərimələr, elektron resurslar, oxu zalı və arxiv.',
    email: 'kitabxana@universitet.edu.az',
  },
  {
    name: 'İT Dəstək',
    slug: 'it-destek',
    description:
      'Portal və e-poçt girişi, parol bərpası, Wi-Fi və şəbəkə, Moodle, kompüter otaqları və texniki nasazlıqlar.',
    email: 'it@universitet.edu.az',
  },
];

interface Metrics {
  model_version?: string;
  algorithm?: string;
  feature_version?: string;
  trained_at?: string;
  dataset_size?: number;
  [key: string]: unknown;
}

/** Reads the metrics written by ml/train.py, if the model has been trained. */
async function readMetrics(): Promise<Metrics | null> {
  const path = resolve(import.meta.dirname, '../../../../ml/models/metrics.json');
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Metrics;
  } catch {
    return null;
  }
}

export async function runSeed(log: (m: string) => void = console.log): Promise<void> {
  const metrics = await readMetrics();

  await withTransaction(async (client) => {
    // --- departments -------------------------------------------------------
    const departmentIds = new Map<string, string>();
    for (const d of DEPARTMENTS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO departments (name, slug, description, email)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, email = EXCLUDED.email
         RETURNING id`,
        [d.name, d.slug, d.description, d.email],
      );
      departmentIds.set(d.slug, rows[0]!.id);
    }
    log(`  ${departmentIds.size} departments`);

    // --- model registry ----------------------------------------------------
    if (metrics?.model_version) {
      await client.query(
        `INSERT INTO ml_models
           (name, version, algorithm, feature_version, dataset_size, is_active, trained_at, metrics, notes)
         VALUES ($1,$2,$3,$4,$5,true,$6,$7::jsonb,$8)
         ON CONFLICT (version) DO UPDATE SET
           algorithm = EXCLUDED.algorithm, dataset_size = EXCLUDED.dataset_size,
           trained_at = EXCLUDED.trained_at, metrics = EXCLUDED.metrics`,
        [
          'Student Request Router',
          metrics.model_version,
          metrics.algorithm ?? 'TF-IDF + Logistic Regression',
          metrics.feature_version ?? 'v1',
          metrics.dataset_size ?? null,
          metrics.trained_at ?? new Date().toISOString(),
          JSON.stringify(metrics),
          'Trained by ml/train.py on the Azerbaijani student-request dataset.',
        ],
      );
      log(`  model ${metrics.model_version} registered (accuracy ${metrics.accuracy})`);
    } else {
      log('  no trained model found — run "npm run ml:train" before starting the API');
    }

    // --- accounts ----------------------------------------------------------
    // Development convenience only; DEPLOYMENT.md documents removing these.
    const accounts: Array<{
      email: string; password: string; first: string; last: string;
      role: 'STUDENT' | 'DEPARTMENT' | 'ADMIN'; department?: string;
    }> = [
      { email: 'admin@udc.local', password: 'AdminPass123!', first: 'Aysel', last: 'Admin', role: 'ADMIN' },
      { email: 'student@udc.local', password: 'StudentPass123!', first: 'Leyla', last: 'Tələbə', role: 'STUDENT' },
      { email: 'dekanat@udc.local', password: 'DekanatPass123!', first: 'Nigar', last: 'Dekanat', role: 'DEPARTMENT', department: 'dekanat' },
      { email: 'maliyye@udc.local', password: 'MaliyyePass123!', first: 'Rashad', last: 'Maliyyə', role: 'DEPARTMENT', department: 'maliyye' },
      { email: 'kitabxana@udc.local', password: 'KitabxanaPass123!', first: 'Səbinə', last: 'Kitabxana', role: 'DEPARTMENT', department: 'kitabxana' },
      { email: 'it@udc.local', password: 'ItPass123!', first: 'Elvin', last: 'İT', role: 'DEPARTMENT', department: 'it-destek' },
    ];

    for (const account of accounts) {
      const hash = await hashPassword(account.password);
      await client.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, department_id)
         VALUES ($1,$2,$3,$4,$5::user_role,$6)
         ON CONFLICT (lower(email)) DO NOTHING`,
        [
          account.email.toLowerCase(), hash, account.first, account.last, account.role,
          account.department ? departmentIds.get(account.department) ?? null : null,
        ],
      );
    }
    log(`  ${accounts.length} demo accounts (see README)`);
  });
}
