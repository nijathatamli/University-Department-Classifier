/**
 * tsc does not copy .sql files, but migrate.js resolves the migrations folder
 * relative to its own directory — so the compiled build needs its own copy.
 * Run as part of `npm run build`.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'src/db/migrations');
const to = resolve(root, 'dist/db/migrations');

if (!existsSync(from)) {
  console.error(`No migrations found at ${from}`);
  process.exit(1);
}

mkdirSync(dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`Copied migrations -> ${to}`);
