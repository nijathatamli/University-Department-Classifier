import { badRequest } from './errors.ts';

/**
 * Small hand-rolled validator. Backend validation is the security boundary —
 * the frontend mirrors these rules in web/assets/validation.js purely for UX.
 * Every failure reports the offending field so the UI can highlight it.
 */
export class Validator {
  private readonly errors: Record<string, string> = {};
  constructor(private readonly body: Record<string, unknown>) {}

  private fail(field: string, message: string): void {
    if (!this.errors[field]) this.errors[field] = message;
  }

  string(field: string, opts: { required?: boolean; min?: number; max?: number } = {}): string | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.fail(field, `${field} is required`);
      return undefined;
    }
    if (typeof raw !== 'string') {
      this.fail(field, `${field} must be text`);
      return undefined;
    }
    const value = raw.trim();
    if (opts.min !== undefined && value.length < opts.min) {
      this.fail(field, `${field} must be at least ${opts.min} characters`);
      return undefined;
    }
    if (opts.max !== undefined && value.length > opts.max) {
      this.fail(field, `${field} must be at most ${opts.max} characters`);
      return undefined;
    }
    return value;
  }

  email(field: string, required = true): string | undefined {
    const value = this.string(field, { required, max: 254 });
    if (value === undefined) return undefined;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      this.fail(field, 'Enter a valid email address');
      return undefined;
    }
    return value.toLowerCase();
  }

  /** Rejects weak passwords outright rather than only measuring them. */
  password(field: string): string | undefined {
    const value = this.string(field, { required: true, min: 8, max: 128 });
    if (value === undefined) return undefined;
    if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
      this.fail(field, 'Password needs at least one lowercase letter, one uppercase letter and one number');
      return undefined;
    }
    return value;
  }

  number(
    field: string,
    opts: { required?: boolean; min?: number; max?: number; integer?: boolean } = {},
  ): number | null | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.fail(field, `${field} is required`);
      return opts.required ? undefined : null;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      this.fail(field, `${field} must be a number`);
      return undefined;
    }
    if (opts.integer && !Number.isInteger(value)) {
      this.fail(field, `${field} must be a whole number`);
      return undefined;
    }
    if (opts.min !== undefined && value < opts.min) {
      this.fail(field, `${field} must be at least ${opts.min}`);
      return undefined;
    }
    if (opts.max !== undefined && value > opts.max) {
      this.fail(field, `${field} must be at most ${opts.max}`);
      return undefined;
    }
    return value;
  }

  uuidArray(field: string, max = 100): string[] {
    const raw = this.body[field];
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      this.fail(field, `${field} must be a list`);
      return [];
    }
    if (raw.length > max) {
      this.fail(field, `${field} may contain at most ${max} entries`);
      return [];
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const out: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string' || !uuid.test(entry)) {
        this.fail(field, `${field} contains an invalid identifier`);
        return [];
      }
      out.push(entry);
    }
    return [...new Set(out)];
  }

  enum<T extends string>(field: string, allowed: readonly T[], required = false): T | undefined {
    const value = this.string(field, { required });
    if (value === undefined) return undefined;
    if (!allowed.includes(value as T)) {
      this.fail(field, `${field} must be one of: ${allowed.join(', ')}`);
      return undefined;
    }
    return value as T;
  }

  /** Throws a 400 carrying every field error at once. */
  assert(): void {
    const fields = Object.keys(this.errors);
    if (fields.length === 0) return;
    throw badRequest(this.errors[fields[0]!]!, { fields: this.errors, field: fields[0] });
  }
}

export const SUBJECT_FIELDS = [
  'mathematics', 'physics', 'chemistry', 'biology', 'programming', 'english',
] as const;

/** Shared parser for the six 0..100 subject scores. */
export function parseScores(body: Record<string, unknown>): Record<string, number | null> {
  const v = new Validator(body);
  const scores: Record<string, number | null> = {};
  for (const subject of SUBJECT_FIELDS) {
    const value = v.number(subject, { min: 0, max: 100 });
    scores[subject] = value === undefined ? null : value;
  }
  v.assert();
  return scores;
}

export function parsePagination(query: Record<string, unknown>, maxPageSize = 50) {
  const page = Math.max(1, Number(query.page) || 1);
  const requested = Number(query.pageSize) || 12;
  const pageSize = Math.min(Math.max(1, requested), maxPageSize);
  return { page, pageSize };
}
