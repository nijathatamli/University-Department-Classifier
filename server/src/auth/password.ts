import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with OWASP's recommended baseline (19 MiB, t=2, p=1).
 * @node-rs/argon2 defaults to the Argon2id variant; tests assert the produced
 * hash carries the `$argon2id$` prefix so a library default change cannot
 * silently downgrade us.
 *
 * Plain passwords are never stored, logged, or returned by the API.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash.
    return false;
  }
}
