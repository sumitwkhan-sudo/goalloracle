#!/usr/bin/env node
/**
 * Pre-deploy guard: load every serverless route under api/ through Node's
 * real ESM loader and fail the build if any can't be resolved.
 *
 * Why this exists: `vite build` resolves extensionless imports and inlines
 * JSON, so it happily passes code that then 500s in Vercel's stricter Node
 * ESM serverless runtime (e.g. `import x from './foo'` with no .js, or a
 * JSON import missing `with { type: 'json' }`). That exact class of bug
 * shipped once and broke the score-recompute cron silently. This check
 * reproduces the serverless loader so it can't ship again.
 *
 * It only fails on STATIC resolution/parse problems (module-not-found,
 * missing import attributes, syntax errors). Runtime/init errors — e.g.
 * firebase-admin throwing because credentials aren't present at build time
 * — are expected here and ignored; they don't indicate a broken import
 * graph.
 *
 * Runs as part of `npm run build`, so both local builds and Vercel gate on
 * it.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_DIR = join(ROOT, 'api');

// Error codes that mean the module graph itself is broken — these WOULD
// 500 the function on Vercel regardless of runtime env.
const FATAL_CODES = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_IMPORT_ATTRIBUTE_MISSING',
  'ERR_IMPORT_ASSERTION_TYPE_MISSING',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_UNSUPPORTED_DIR_IMPORT',
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const files = walk(API_DIR);
const failures = [];

for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (err) {
    const code = err?.code;
    const isStaticFailure = FATAL_CODES.has(code) || err instanceof SyntaxError;
    if (isStaticFailure) {
      failures.push({
        file: relative(ROOT, file),
        code: code || 'SyntaxError',
        message: String(err?.message || err).split('\n')[0],
      });
    }
    // Non-static (runtime/init) errors are expected at build time — ignore.
  }
}

if (failures.length > 0) {
  console.error(`\n✗ API import check FAILED — ${failures.length} route(s) would 500 in the serverless runtime:\n`);
  for (const f of failures) {
    console.error(`  ${f.file}`);
    console.error(`    ${f.code}: ${f.message}\n`);
  }
  console.error('Fix: add explicit .js extensions to relative imports, and');
  console.error('`with { type: \'json\' }` to JSON imports in the reachable chain.\n');
  process.exit(1);
}

console.log(`✓ API import check passed (${files.length} serverless modules load under Node ESM)`);
