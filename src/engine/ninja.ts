// Parsing of poe.ninja PoE2 economy responses. Shared by the browser app and
// scripts/fetch-prices.mjs (Node runs this file directly with type stripping,
// so keep it to plain, erasable TypeScript).

export const NINJA_BASE = 'https://poe.ninja/poe2/api/economy/exchange/current/overview';
/** Categories that contain crafting items. Unknown ones are skipped. */
export const NINJA_TYPES = ['Currency', 'Essences', 'Omens', 'Abyss', 'Ritual', 'Fragments', 'Runes', 'SoulCores', 'Expedition', 'Delirium', 'Breach'];

export interface NinjaOverview {
  values: Map<string, number>;
  /** item name -> icon URL */
  icons: Map<string, string>;
  primary?: string;
  rates: Record<string, number>;
}

interface RawLine {
  id?: string;
  name?: string;
  currencyTypeName?: string;
  primaryValue?: number;
  chaosEquivalent?: number;
  value?: number;
}
interface RawItem {
  id?: string;
  name?: string;
  image?: string;
  icon?: string;
}
interface RawOverview {
  items?: RawItem[];
  lines?: RawLine[];
  core?: { items?: RawItem[]; primary?: string; rates?: Record<string, number> };
}

export function parseOverview(json: RawOverview): NinjaOverview {
  const items = new Map<string, string>();
  const icons = new Map<string, string>();
  for (const it of [...(json.items ?? []), ...(json.core?.items ?? [])]) {
    if (it && it.id && it.name) items.set(it.id, it.name);
    const img = it?.image || it?.icon;
    if (it?.name && typeof img === 'string') icons.set(it.name, img.startsWith('/') ? `https://web.poecdn.com${img}` : img);
  }
  const values = new Map<string, number>();
  for (const line of json.lines ?? []) {
    const name = (line.id && items.get(line.id)) || line.name || line.currencyTypeName;
    const v = line.primaryValue ?? line.chaosEquivalent ?? line.value;
    if (name && typeof v === 'number' && v > 0) values.set(name, v);
  }
  return { values, icons, primary: json.core?.primary, rates: json.core?.rates ?? {} };
}

/**
 * Converts collected values (in the API's primary currency, usually divine)
 * to Exalted Orbs. Returns null if the exalt rate cannot be found.
 */
export function toExalts(values: Map<string, number>, primary: string | undefined, rates: Record<string, number>): Record<string, number> | null {
  let exaltInPrimary = values.get('Exalted Orb');
  if (!exaltInPrimary && typeof primary === 'string' && /exalt/i.test(primary)) exaltInPrimary = 1;
  if (!exaltInPrimary && typeof rates.exalted === 'number' && rates.exalted > 0) exaltInPrimary = 1 / rates.exalted;
  if (!exaltInPrimary) return null;
  const out: Record<string, number> = {};
  for (const [name, v] of values) out[name] = +(v / exaltInPrimary).toPrecision(5);
  out['Exalted Orb'] = 1;
  return out;
}

/** Downloads and converts all categories for a league. */
export async function fetchNinjaPrices(
  league: string,
  fetcher: (url: string) => Promise<unknown>,
  log: (msg: string) => void = () => {},
  icons?: Record<string, string>,
): Promise<Record<string, number> | null> {
  const values = new Map<string, number>();
  let primary: string | undefined;
  let rates: Record<string, number> = {};
  for (const type of NINJA_TYPES) {
    try {
      const j = parseOverview((await fetcher(`${NINJA_BASE}?league=${encodeURIComponent(league)}&type=${type}`)) as RawOverview);
      primary = primary ?? j.primary;
      if (Object.keys(j.rates).length) rates = j.rates;
      for (const [k, v] of j.values) values.set(k, v);
      if (icons) for (const [k, v] of j.icons) icons[k] = v;
      log(`  ${type}: ${j.values.size} items`);
    } catch (e) {
      log(`  ${type}: skipped (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return toExalts(values, primary, rates);
}
