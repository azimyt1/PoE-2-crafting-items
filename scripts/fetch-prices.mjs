#!/usr/bin/env node
// Downloads current currency prices for a PoE2 league from poe.ninja and
// writes public/data/prices.json (all values in Exalted Orbs).
//
// Usage:
//   node scripts/fetch-prices.mjs "League Name"
//   LEAGUE="League Name" node scripts/fetch-prices.mjs
// Without a league the script tries to discover the current one.
//
// API docs: https://poe.ninja/docs/api (economy overview endpoints).

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('public/data/prices.json');
const BASE = 'https://poe.ninja/poe2/api/economy/exchange/current/overview';
// Categories that contain crafting items. Unknown ones are skipped.
const TYPES = ['Currency', 'Essences', 'Omens', 'Abyss', 'Ritual', 'Fragments', 'Runes', 'SoulCores', 'Expedition', 'Delirium', 'Breach'];

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

function parseOverview(json) {
  const items = new Map();
  for (const it of [...(json.items ?? []), ...(json.core?.items ?? [])]) if (it?.id && it?.name) items.set(it.id, it.name);
  const values = new Map();
  for (const line of json.lines ?? []) {
    const name = items.get(line.id) ?? line.name ?? line.currencyTypeName;
    const v = line.primaryValue ?? line.chaosEquivalent ?? line.value;
    if (name && typeof v === 'number' && v > 0) values.set(name, v);
  }
  return { values, primary: json.core?.primary, rates: json.core?.rates ?? {} };
}

async function main() {
  const league = process.argv[2] || process.env.LEAGUE || (await discoverLeague());
  if (!league) {
    console.error('League is unknown: pass it as an argument or set LEAGUE.');
    process.exit(1);
  }
  console.log(`Fetching prices for league "${league}"`);
  const raw = new Map();
  let primary;
  let rates = {};
  for (const type of TYPES) {
    try {
      const j = await getJson(`${BASE}?league=${encodeURIComponent(league)}&type=${type}`);
      const p = parseOverview(j);
      primary ??= p.primary;
      if (Object.keys(p.rates).length) rates = p.rates;
      for (const [k, v] of p.values) raw.set(k, v);
      console.log(`  ${type}: ${p.values.size} items`);
    } catch (e) {
      console.warn(`  ${type}: skipped (${e.message})`);
    }
  }
  // Convert to Exalted Orbs.
  let exaltInPrimary = raw.get('Exalted Orb');
  if (!exaltInPrimary && typeof primary === 'string' && /exalt/i.test(primary)) exaltInPrimary = 1;
  if (!exaltInPrimary && typeof rates.exalted === 'number' && rates.exalted > 0) exaltInPrimary = 1 / rates.exalted;
  if (!exaltInPrimary) {
    console.error('Could not find the Exalted Orb rate; prices not written.');
    process.exit(1);
  }
  const prices = {};
  for (const [name, v] of raw) prices[name] = +(v / exaltInPrimary).toPrecision(5);
  prices['Exalted Orb'] = 1;
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
