// summary-copy.js is generated from the frontend's weekly summary strings and locale packs (the
// api image has no frontend to read them from at runtime). A string changed on one side only fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('api/summary-copy.js matches the frontend strings (node scripts/build-summary-copy.mjs)', async t => {
  if (!fs.existsSync(path.join(API, '..', 'frontend', 'src', 'lib', 'weekly-summary.js'))) return t.skip('no frontend next to the api');
  const { buildSummaryCopy } = await import('../scripts/build-summary-copy.mjs');
  assert.equal(fs.readFileSync(path.join(API, 'summary-copy.js'), 'utf8'), await buildSummaryCopy(),
    'api/summary-copy.js is out of date: run node scripts/build-summary-copy.mjs in api/');
});
