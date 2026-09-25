#!/usr/bin/env node
// Downloads current currency prices for a PoE2 league from poe.ninja and
// writes public/data/prices.json (all values in Exalted Orbs).
//
// Usage:
//   node scripts/fetch-prices.mjs "League Name"
//   LEAGUE="League Name" node scripts/fetch-prices.mjs
// Without a league the script tries to discover the current one.
// Requires Node 22.18+ (runs the shared TypeScript parser directly).
//
// API docs: https://poe.ninja/docs/api (economy overview endpoints).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchNinjaPrices } from '../src/engine/ninja.ts';

const OUT = path.resolve('public/data/prices.json');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'poe2-craft-assistant (github.com/azimyt1/PoE-2-crafting-items)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function discoverLeague() {
  for (const url of ['https://poe.ninja/poe2/api/data/index-state', 'https://poe.ninja/api/data/poe2/index-state']) {
    try {
      const j = await getJson(url);
      const lists = [j.economyLeagues, j.leagues, j.currentLeagues].filter(Array.isArray);
      for (const list of lists) {
        const names = list.map((l) => l.displayName || l.name || l.url).filter(Boolean);
        const main = names.find((n) => !/hardcore|\bhc\b|standard|ssf|ruthless/i.test(n));
        if (main) return main;
      }
    } catch (e) {
      console.warn(`League discovery failed at ${url}: ${e.message}`);
    }
  }
  return null;
}

async function main() {
  const league = process.argv[2] || process.env.LEAGUE || (await discoverLeague());
  if (!league) {
    console.error('League is unknown: pass it as an argument or set LEAGUE.');
    process.exit(1);
  }
  console.log(`Fetching prices for league "${league}"`);
  const prices = await fetchNinjaPrices(league, getJson, (m) => console.log(m));
  if (!prices) {
    console.error('Could not find the Exalted Orb rate; prices not written.');
    process.exit(1);
  }
  const n = Object.keys(prices).length;
  if (n < 10) {
    console.error(`Only ${n} prices parsed; the API format may have changed. File not written.`);
    process.exit(1);
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({ league, updatedAt: new Date().toISOString(), source: 'poe.ninja', prices }, null, 1));
  console.log(`Wrote ${n} prices to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
