#!/usr/bin/env node
// Builds compact game data for the app from the RePoE PoE2 export
// (https://github.com/repoe-fork/poe2, data exported from the game client).
//
// Usage:
//   node scripts/build-data.mjs                          # downloads from GitHub
//   node scripts/build-data.mjs <repoe-dir> [<ee2-dir>]  # uses local copies
//
// Output: public/data/{bases,mods,meta,ru}.json

import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE = 'https://raw.githubusercontent.com/repoe-fork/poe2/master';
// Russian translations of stat lines and base names (MIT, Exiled Exchange 2).
const EE2 = 'https://raw.githubusercontent.com/Kvan7/Exiled-Exchange-2/master/dataParser/output';
const OUT = path.resolve('public/data');

// Item classes we support for crafting, with Russian display names.
const CLASSES = {
  'Body Armour': 'Нагрудник',
  Helmet: 'Шлем',
  Gloves: 'Перчатки',
  Boots: 'Сапоги',
  Shield: 'Щит',
  Buckler: 'Баклер',
  Focus: 'Фокус',
  Quiver: 'Колчан',
  Ring: 'Кольцо',
  Amulet: 'Амулет',
  Belt: 'Пояс',
  'One Hand Sword': 'Одноручный меч',
  'Two Hand Sword': 'Двуручный меч',
  'One Hand Axe': 'Одноручный топор',
  'Two Hand Axe': 'Двуручный топор',
  'One Hand Mace': 'Одноручная булава',
  'Two Hand Mace': 'Двуручная булава',
  Dagger: 'Кинжал',
  Claw: 'Когти',
  Spear: 'Копьё',
  Flail: 'Цеп',
  Warstaff: 'Боевой посох (квотерстафф)',
  Staff: 'Посох',
  Wand: 'Жезл',
  Sceptre: 'Скипетр',
  Bow: 'Лук',
  Crossbow: 'Арбалет',
  Talisman: 'Талисман',
};

async function load(name, localDir) {
  if (localDir) return JSON.parse(await fs.readFile(path.join(localDir, `${name}.json`), 'utf8'));
  const url = `${SOURCE}/data/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  return res.json();
}

async function loadVersion(localDir) {
  if (localDir) {
    try {
      return (await fs.readFile(path.join(localDir, 'version.txt'), 'utf8')).trim();
    } catch {
      return 'local';
    }
  }
  try {
    const res = await fetch(`${SOURCE}/version.txt`);
    return res.ok ? (await res.text()).trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}

// Normalised line template: numbers and ranges become '#', signs dropped, lowercase.
// Must stay identical to src/engine/parseItem.ts:template().
export function template(line) {
  return line
    .replace(/\(-?\d+(?:\.\d+)?-(-?\d+(?:\.\d+)?)\)/g, '#')
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, '#')
    .replace(/[+-]#/g, '#')
    .replace(/#\s*#/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function loadEe2(name, ee2Dir) {
  if (ee2Dir) return fs.readFile(path.join(ee2Dir, name), 'utf8');
  const res = await fetch(`${EE2}/${name}`);
  if (!res.ok) throw new Error(`${res.status} ${name}`);
  return res.text();
}

// "+(5-8) to [Strength|Strength]" -> "+(5-8) to Strength"
export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
    .trim();
}

// Keep spawn weights up to (and including) the first "default" entry: RePoE
// semantics are "first tag present on the item decides the weight".
function compactWeights(spawn) {
  const out = [];
  for (const s of spawn) {
    out.push([s.tag, s.weight]);
    if (s.tag === 'default') break;
  }
  return out;
}

function weightFor(spawn, tags) {
  for (const [tag, w] of spawn) if (tags.has(tag)) return w;
  return 0;
}

async function main() {
  const localDir = process.argv[2];
  console.log(localDir ? `Reading RePoE data from ${localDir}` : `Downloading RePoE data from ${SOURCE}`);
  const [mods, baseItems, version] = await Promise.all([
    load('mods', localDir),
    load('base_items', localDir),
    loadVersion(localDir),
  ]);

  // ---- bases ----
  const bases = [];
  for (const [id, b] of Object.entries(baseItems)) {
    if (!(b.item_class in CLASSES)) continue;
    if (b.release_state !== 'released' || b.domain !== 'item') continue;
    const tags = b.tags || [];
    if (tags.includes('not_for_sale') || tags.includes('demigods')) continue;
    if (!b.name || b.name.startsWith('[')) continue;
    const implicits = (b.implicits || [])
      .map((m) => cleanText(mods[m]?.text))
      .filter(Boolean);
    const p = b.properties || {};
    bases.push({
      id,
      name: b.name,
      cls: b.item_class,
      tags,
      lvl: b.drop_level || 1,
      imp: implicits,
      def: {
        ar: p.armour ?? undefined,
        ev: p.evasion ?? undefined,
        es: p.energy_shield ?? undefined,
      },
    });
  }
  bases.sort((a, b) => a.cls.localeCompare(b.cls) || a.lvl - b.lvl || a.name.localeCompare(b.name));

  // All tags that appear on supported bases.
  const baseTagSets = bases.map((b) => new Set(b.tags));

  // ---- mods ----
  const outMods = [];
  for (const [id, m] of Object.entries(mods)) {
    if (m.domain !== 'item' && m.domain !== 'desecrated') continue;
    if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue;
    const w = compactWeights(m.spawn_weights || []);
    // Essence and alloy modifiers never roll naturally (weight 0) but can be
    // added by essences and alloys (see scripts/build-coe.mjs).
    const essenceOnly = m.domain === 'item' && /^(Essence|Alloy)/.test(id) && !w.some(([, x]) => x > 0);
    if (!essenceOnly) {
      if (!w.some(([, x]) => x > 0)) continue;
      // Must be able to spawn on at least one supported base.
      if (!baseTagSets.some((tags) => weightFor(w, tags) > 0)) continue;
    }
    const stats = (m.stats || []).map((s) => s.id);
    const side = m.generation_type === 'prefix' ? 'p' : 's';
    outMods.push({
      id,
      n: m.name || '',
      s: side,
      g: m.groups || [],
      f: `${side}:${m.domain === 'desecrated' ? 'd:' : ''}${[...stats].sort().join('+') || m.type}`,
      l: m.required_level || 1,
      x: cleanText(m.text),
      w,
      tg: m.implicit_tags || [],
      d: m.domain === 'desecrated' ? 1 : 0,
      ...(essenceOnly ? { e: 1 } : {}),
      st: (m.stats || []).map((s) => [s.min, s.max]),
    });
  }
  outMods.sort((a, b) => a.f.localeCompare(b.f) || a.l - b.l);

  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'bases.json'), JSON.stringify(bases));
  await fs.writeFile(path.join(OUT, 'mods.json'), JSON.stringify(outMods));
  await fs.writeFile(
    path.join(OUT, 'meta.json'),
    JSON.stringify(
      {
        gameVersion: version,
        builtAt: new Date().toISOString(),
        source: 'https://github.com/repoe-fork/poe2',
        classes: CLASSES,
        counts: { bases: bases.length, mods: outMods.length },
      },
      null,
      2,
    ),
  );
  console.log(`Game version ${version}: ${bases.length} bases, ${outMods.length} mods written to ${OUT}`);

  // ---- Russian client support
  try {
    const ee2Dir = process.argv[3];
    const ndjson = (t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const [ruStats, ruItems] = await Promise.all([loadEe2('ru/stats.ndjson', ee2Dir), loadEe2('ru/items.ndjson', ee2Dir)]);
    const known = new Set(outMods.flatMap((m) => m.x.split('\n').map(template)));
    const templates = {};
    for (const e of ndjson(ruStats)) {
      const en = template(e.ref || '');
      if (!known.has(en)) continue;
      for (const m of e.matchers || []) if (m.string && !m.negate) templates[template(m.string)] = en;
    }
    const baseNames = new Set(bases.map((b) => b.name));
    const ruBases = {};
    for (const it of ndjson(ruItems)) if (it.namespace === 'ITEM' && baseNames.has(it.refName) && it.name) ruBases[it.name] = it.refName;
    await fs.writeFile(path.join(OUT, 'ru.json'), JSON.stringify({ source: 'Exiled Exchange 2 (MIT)', templates, bases: ruBases }));
    console.log(`Russian: ${Object.keys(templates).length} line templates, ${Object.keys(ruBases).length} base names`);
  } catch (e) {
    console.warn(`Russian data skipped: ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
