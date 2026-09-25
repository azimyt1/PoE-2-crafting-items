#!/usr/bin/env node
// Imports community modifier weights from Craft of Exile
// (https://www.craftofexile.com/weightings?game=poe2) and matches every weighted
// tier to a modifier of our game data (public/data/mods.json).
//
// Usage:
//   node scripts/build-weights.mjs                  # downloads poec_data.json
//   node scripts/build-weights.mjs <poec_data.json> # uses a local copy
//
// Output: public/data/weights.json
//   { source, builtAt, groups: { "<CoE base group>": { "<mod id>": weight } },
//     bases: { "<base name>": "<CoE base group>" } }
// A modifier missing from a group has no community weight (the app falls back
// to its default weight). Bases whose group has no known weights are left out.

import fs from 'node:fs/promises';
import path from 'node:path';

const URL_DATA = 'https://www.craftofexile.com/json/poe2/main/poec_data.json';
const UA = 'poe2-craft-assistant (github.com/azimyt1/PoE-2-crafting-items)';
const DATA = path.resolve('public/data');

/** Normalised text: numbers and ranges become '#', punctuation and case ignored. */
export function textKey(s) {
  return String(s ?? '')
    .replace(/\(-?\d+(?:\.\d+)?-(-?\d+(?:\.\d+)?)\)/g, '#')
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, '#')
    .toLowerCase()
    .replace(/[^a-z#]+/g, '');
}

const setKey = (arr) => [...arr].sort().join('|');

function parseCoe(text) {
  // The file is a script: `poecd={...}`
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

async function loadCoe(file) {
  if (file) return parseCoe(await fs.readFile(file, 'utf8'));
  const res = await fetch(URL_DATA, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Failed to download ${URL_DATA}: ${res.status}`);
  return parseCoe(await res.text());
}

function spawnable(mod, tags) {
  for (const [tag, w] of mod.w) if (tags.has(tag)) return w > 0;
  return false;
}

export function buildWeights(coe, mods, bases) {
  const baseName = new Map(coe.bases.seq.map((b) => [b.id_base, b.name_base]));
  const coeMods = new Map(coe.modifiers.seq.map((m) => [m.id_modifier, m]));
  // our base name -> CoE group
  const groupOf = new Map();
  for (const bi of coe.bitems.seq) {
    const g = baseName.get(bi.id_base);
    if (g && !groupOf.has(bi.name_bitem)) groupOf.set(bi.name_bitem, g);
  }

  const out = { groups: {}, bases: {} };
  const stats = { tiers: 0, matched: 0, unknown: 0, ambiguous: 0, unmatched: 0 };
  const unmatchedSamples = [];
  const groupsDone = new Set();

  for (const base of bases) {
    const g = groupOf.get(base.name);
    if (!g) continue;
    out.bases[base.name] = g;
    if (groupsDone.has(g)) continue;
    groupsDone.add(g);
    const idBase = coe.bases.seq.find((b) => b.name_base === g).id_base;
    const tags = new Set(base.tags);
    // candidates on this base, indexed by side + groups + level
    const index = new Map();
    for (const m of mods) {
      if (!spawnable(m, tags)) continue;
      const k = `${m.s}|${m.d}|${setKey(m.g)}|${m.l}`;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(m);
    }
    const weights = {};
    for (const idMod of coe.basemods[idBase] ?? []) {
      const cm = coeMods.get(idMod);
      if (!cm || (cm.affix !== 'prefix' && cm.affix !== 'suffix')) continue;
      // 1 = regular modifiers, 10 = desecrated; essence-only ones are skipped
      if (cm.id_mgroup !== '1' && cm.id_mgroup !== '10') continue;
      const tiers = coe.tiers[idMod]?.[idBase];
      if (!tiers) continue;
      let groups;
      try {
        groups = JSON.parse(cm.modgroups ?? '[]') ?? [];
      } catch {
        groups = [];
      }
      const side = cm.affix === 'prefix' ? 'p' : 's';
      const d = cm.id_mgroup === '10' ? 1 : 0;
      const tk = textKey(cm.name_modifier);
      for (const t of tiers) {
        stats.tiers++;
        let cands = index.get(`${side}|${d}|${setKey(groups)}|${+t.ilvl}`) ?? [];
        if (cands.length > 1) cands = cands.filter((m) => textKey(m.x) === tk);
        if (cands.length === 1) {
          // Craft of Exile uses 1 (and 0) as "weight unknown": skip, the app keeps its default.
          if (+t.weighting > 1) weights[cands[0].id] = +t.weighting;
          else stats.unknown++;
          stats.matched++;
        } else if (cands.length > 1) stats.ambiguous++;
        else {
          stats.unmatched++;
          if (unmatchedSamples.length < 15) unmatchedSamples.push(`${g}: ${cm.affix} ${cm.name_modifier} (ур. ${t.ilvl})`);
        }
      }
    }
    if (Object.keys(weights).length) out.groups[g] = weights;
  }
  for (const [b, g] of Object.entries(out.bases)) if (!out.groups[g]) delete out.bases[b];
  return { out, stats, unmatchedSamples };
}

async function main() {
  const file = process.argv[2];
  console.log(file ? `Reading Craft of Exile data from ${file}` : `Downloading ${URL_DATA}`);
  const [coe, mods, bases] = await Promise.all([
    loadCoe(file),
    fs.readFile(path.join(DATA, 'mods.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(DATA, 'bases.json'), 'utf8').then(JSON.parse),
  ]);
  const { out, stats, unmatchedSamples } = buildWeights(coe, mods, bases);
  const result = {
    source: 'https://www.craftofexile.com/weightings?game=poe2',
    builtAt: new Date().toISOString(),
    ...out,
  };
  await fs.writeFile(path.join(DATA, 'weights.json'), JSON.stringify(result));
  console.log(
    `Weights: ${Object.keys(out.groups).length} base groups, ${Object.keys(out.bases).length} bases; ` +
      `tiers ${stats.tiers}, matched ${stats.matched} (weight unknown ${stats.unknown}), ambiguous ${stats.ambiguous}, unmatched ${stats.unmatched}`,
  );
  for (const s of unmatchedSamples) console.log(`  not matched: ${s}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
