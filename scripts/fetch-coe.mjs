#!/usr/bin/env node
// Downloads the raw data files of Craft of Exile (https://www.craftofexile.com,
// community mod weights for PoE 2) so the format can be studied and imported.
//
// It starts from the PoE 2 pages, follows every same-site .js / .json file
// they reference (and .json paths mentioned inside those scripts), and saves
// everything with an index of what was fetched.
//
// Usage: node scripts/fetch-coe.mjs [outDir]   (default: coe-raw)
// Please keep it polite: this runs at most once a day in GitHub Actions.

import fs from 'node:fs/promises';
import path from 'node:path';

const SITE = 'https://www.craftofexile.com';
const OUT = path.resolve(process.argv[2] ?? 'coe-raw');
const UA = 'poe2-craft-assistant (github.com/azimyt1/PoE-2-crafting-items)';
const MAX_FILES = 60;
const MAX_BYTES = 60 * 1024 * 1024;

const START = ['/?game=poe2', '/weightings?game=poe2', '/emulator?game=poe2'];
// Paths used by the site in the past; tried in case the pages load them indirectly.
const GUESSES = [
  '/json/poe2/main/poec_data.json',
  '/json/poe2/lang/poec_lang.us.json',
  '/json/poe2/lang/poec_lang.ru.json',
  '/json/data/main/poec_data.json',
];

const seen = new Set();
const queue = [...START, ...GUESSES].map((p) => new URL(p, SITE).href);
const index = [];

function fileName(url) {
  const u = new URL(url);
  const name = (u.pathname + (u.search ? '_' + u.search.slice(1) : '')).replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return name || 'index.html';
}

function refsIn(text, base) {
  const out = new Set();
  const patterns = [
    /(?:src|href)\s*=\s*["']([^"']+)["']/gi,
    /["'`]((?:https?:\/\/[^"'`\s]*craftofexile\.com)?\/?[^"'`\s<>()]*?\.(?:json|js)(?:\?[^"'`\s<>()]*)?)["'`]/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      try {
        const u = new URL(m[1], base);
        if (u.hostname.endsWith('craftofexile.com') && /\.(js|json)$/i.test(u.pathname)) out.add(u.href);
      } catch {
        // not a URL
      }
    }
  }
  return [...out];
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  let fetched = 0;
  while (queue.length && fetched < MAX_FILES) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const entry = { url, file: null, status: 0, bytes: 0, type: '' };
    index.push(entry);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      entry.status = res.status;
      entry.type = res.headers.get('content-type') ?? '';
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      entry.bytes = buf.length;
      if (buf.length > MAX_BYTES) continue;
      entry.file = fileName(url);
      await fs.writeFile(path.join(OUT, entry.file), buf);
      fetched++;
      const text = buf.toString('utf8');
      for (const ref of refsIn(text, url)) if (!seen.has(ref)) queue.push(ref);
      console.log(`${res.status} ${buf.length} ${url}`);
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      console.log(`ERR ${url}: ${entry.error}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), files: index }, null, 1));
  console.log(`Saved ${fetched} files to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
