import { useEffect, useMemo, useRef, useState } from 'react';
import type { Setup, StrategyResult } from './api';
import { DEFAULT_PRICES } from './engine/currency';
import { DEFAULT_ESSENCE_PRICES } from './engine/essences';
import { buildCtx } from './engine/item';
import type { BaseDef, EssenceDef, Item, ModDef, Prices, TargetReq } from './engine/types';
import { familiesOf } from './ui/families';
import type { DisplayCurrency } from './ui/format';
import { ItemSetup } from './ui/ItemSetup';
import { TargetEditor } from './ui/TargetEditor';
import { Results } from './ui/Results';
import { Tracker } from './ui/Tracker';
import { PricesPanel, type PricesFile } from './ui/PricesPanel';
import { WeightsPanel } from './ui/WeightsPanel';
import { Sandbox } from './ui/Sandbox';
import { CurrentItem, type ItemInfo } from './ui/CurrentItem';
import { HowItWorks } from './ui/HowItWorks';
import { WorkerClient } from './ui/workerClient';
import { GameLink, type LinkMode } from './ui/GameLink';
import { ItemParser, type ParsedItem, type RuData } from './engine/parseItem';

interface Meta {
  gameVersion: string;
  builtAt: string;
  classes: Record<string, string>;
}

/** Community modifier weights (Craft of Exile), built by scripts/build-weights.mjs */
interface WeightsFile {
  source: string;
  builtAt: string;
  groups: Record<string, Record<string, number>>;
  bases: Record<string, string>;
}

/** Exact essence table (Craft of Exile), built by scripts/build-coe.mjs */
interface EssencesFile {
  bases: Record<string, string>;
  groups: Record<string, EssenceDef[]>;
}

interface Saved {
  cls: string;
  baseId: string;
  ilvl: number;
  baseCost: number;
  reqs: TargetReq[];
  need: number;
  open?: { p: number; s: number };
  groupNeed?: Record<string, number>;
  item?: Item;
  bought?: Item | null;
  itemInfo?: ItemInfo | null;
  unkept?: string[];
  priceOverrides: Prices;
  weights: Record<string, number>;
  currency: DisplayCurrency;
  trials: number;
  linkMode: LinkMode;
}

const STORE_KEY = 'poe2craft:v1';

function loadSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

type Tab = 'goal' | 'results' | 'tracker' | 'sandbox' | 'prices' | 'weights' | 'help';

export default function App() {
  const saved = useMemo(loadSaved, []);
  const [data, setData] = useState<{
    bases: BaseDef[];
    mods: ModDef[];
    meta: Meta;
    pricesFile: PricesFile | null;
    ru: RuData | null;
    weights: WeightsFile | null;
    essences: EssencesFile | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const client = useRef<WorkerClient | null>(null);

  const [tab, setTab] = useState<Tab>('goal');
  const [cls, setCls] = useState(saved.cls ?? 'Ring');
  const [baseId, setBaseId] = useState(saved.baseId ?? '');
  const [ilvl, setIlvl] = useState(saved.ilvl ?? 82);
  const [baseCost, setBaseCost] = useState(saved.baseCost ?? 1);
  const [reqs, setReqs] = useState<TargetReq[]>(saved.reqs ?? []);
  const [need, setNeed] = useState(saved.need ?? 0);
  const [open, setOpen] = useState(saved.open ?? { p: 0, s: 0 });
  const [groupNeed, setGroupNeed] = useState<Record<string, number>>(saved.groupNeed ?? {});
  const [priceOverrides, setPriceOverrides] = useState<Prices>(saved.priceOverrides ?? {});
  const [weights, setWeights] = useState<Record<string, number>>(saved.weights ?? {});
  const [currency, setCurrency] = useState<DisplayCurrency>(saved.currency ?? 'ex');
  const [trials, setTrials] = useState(saved.trials ?? 400);
  const [linkMode, setLinkMode] = useState<LinkMode>(saved.linkMode ?? 'paste');
  const [pricesFile, setPricesFile] = useState<PricesFile | null>(null);
  const [now, setNow] = useState(Date.now());

  const [results, setResults] = useState<StrategyResult[]>([]);
  const [running, setRunning] = useState(false);
  const [resultsFor, setResultsFor] = useState('');
  const [trackerItem, setTrackerItem] = useState<Item>(saved.item ?? { rarity: 'normal', mods: [] });
  // the item as bought / pasted: kept modifiers and "buy it again" refer to it
  const [bought, setBought] = useState<Item | null>(saved.bought ?? null);
  const [itemInfo, setItemInfo] = useState<ItemInfo | null>(saved.itemInfo ?? null);
  const [unkept, setUnkept] = useState<string[]>(saved.unkept ?? []);
  const [trackerStrategy, setTrackerStrategy] = useState('full');

  // ---- load data
  useEffect(() => {
    (async () => {
      try {
        const get = async (f: string) => {
          const r = await fetch(`./data/${f}`);
          if (!r.ok) throw new Error(`${f}: ${r.status}`);
          return r.json();
        };
        const [bases, mods, meta] = await Promise.all([get('bases.json'), get('mods.json'), get('meta.json')]);
        let pricesFile: PricesFile | null = null;
        try {
          pricesFile = await get('prices.json');
        } catch {
          pricesFile = null;
        }
        let ru: RuData | null = null;
        try {
          ru = await get('ru.json');
        } catch {
          ru = null;
        }
        let weightsFile: WeightsFile | null = null;
        try {
          weightsFile = await get('weights.json');
        } catch {
          weightsFile = null;
        }
        let essencesFile: EssencesFile | null = null;
        try {
          essencesFile = await get('essences.json');
        } catch {
          essencesFile = null;
        }
        setData({ bases, mods, meta, pricesFile, ru, weights: weightsFile, essences: essencesFile });
        setPricesFile(pricesFile);
        const c = new WorkerClient();
        client.current = c;
        await c.init(mods, bases);
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  // ---- persist
  useEffect(() => {
    try {
      const s: Saved = {
        cls,
        baseId,
        ilvl,
        baseCost,
        reqs,
        need,
        open,
        groupNeed,
        item: trackerItem,
        bought,
        itemInfo,
        unkept,
        priceOverrides,
        weights,
        currency,
        trials,
        linkMode,
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }, [cls, baseId, ilvl, baseCost, reqs, need, open, groupNeed, trackerItem, bought, itemInfo, unkept, priceOverrides, weights, currency, trials, linkMode]);

  const parser = useMemo(() => (data ? new ItemParser(data.bases, data.mods, data.ru ?? undefined) : null), [data]);

  /** An item read from the game: switch to its base and item level. */
  function applyGameBase(p: ParsedItem) {
    if (p.base) {
      setCls(p.base.cls);
      setBaseId(p.base.id);
    }
    if (p.ilvl) setIlvl(p.ilvl);
  }

  function applyGameItem(p: ParsedItem) {
    applyGameBase(p);
    const rarity = p.rarity === 'magic' || p.rarity === 'rare' ? p.rarity : 'normal';
    const item: Item = { rarity, mods: p.mods.map((m) => m.mod) };
    setTrackerItem(item);
    setBought(item.rarity !== 'normal' || item.mods.length ? item : null);
    setItemInfo({
      name: p.name,
      baseName: p.base?.name ?? p.baseName,
      ilvl: p.ilvl,
      props: p.props,
      implicits: p.implicits,
      runes: p.runes,
      corrupted: p.corrupted,
    });
    setUnkept([]);
  }

  // Re-read published prices every 15 minutes, so an open page stays current.
  async function refreshPrices(): Promise<boolean> {
    try {
      const r = await fetch(`./data/prices.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return false;
      const f = (await r.json()) as PricesFile;
      setPricesFile((cur) => (!cur || f.updatedAt > cur.updatedAt ? f : cur));
      return true;
    } catch {
      return false;
    }
  }
  useEffect(() => {
    const t = setInterval(() => {
      void refreshPrices();
      setNow(Date.now());
    }, 15 * 60 * 1000);
    const clock = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, []);

  const prices: Prices = useMemo(
    () => ({ ...DEFAULT_PRICES, ...DEFAULT_ESSENCE_PRICES, ...(pricesFile?.prices ?? {}), ...priceOverrides }),
    [pricesFile, priceOverrides],
  );
  const priceAgeH = pricesFile ? (now - Date.parse(pricesFile.updatedAt)) / 3600000 : Infinity;

  const base = useMemo(() => data?.bases.find((b) => b.id === baseId) ?? null, [data, baseId]);

  // choose a default base for the class
  useEffect(() => {
    if (!data) return;
    if (!base || base.cls !== cls) {
      const list = data.bases.filter((b) => b.cls === cls);
      const pick = list[list.length - 1] ?? data.bases[0];
      if (pick) setBaseId(pick.id);
    }
  }, [data, cls, base]);

  // Craft of Exile weights for this base; the user's own weights override them.
  const community = useMemo(() => {
    const group = base && data?.weights?.bases[base.name];
    return { group: group || null, weights: (group && data?.weights?.groups[group]) || {} };
  }, [data, base]);
  const effWeights = useMemo(() => ({ ...community.weights, ...weights }), [community, weights]);

  const essences = useMemo(() => {
    const group = base && data?.essences?.bases[base.name];
    return (group && data?.essences?.groups[group]) || [];
  }, [data, base]);

  const ctx = useMemo(() => {
    if (!data || !base) return null;
    return buildCtx({ base, ilvl, mods: data.mods, prices, baseCost, weightOverrides: effWeights, essences });
  }, [data, base, ilvl, prices, baseCost, effWeights, essences]);

  const families = useMemo(() => (ctx ? familiesOf(ctx) : []), [ctx]);

  // drop reqs that are not available on the new base
  useEffect(() => {
    if (!families.length) return;
    const avail = new Set(families.map((f) => f.fam));
    setReqs((rs) => (rs.every((r) => avail.has(r.fam)) ? rs : rs.filter((r) => avail.has(r.fam))));
  }, [families]);

  // Modifiers already on the item that the target keeps (all unless unticked).
  const kept = useMemo(() => {
    if (!ctx) return [] as TargetReq[];
    const out: TargetReq[] = [];
    for (const m of bought?.mods ?? []) {
      const d = ctx.byId.get(m.id);
      if (!d || unkept.includes(m.id) || out.some((r) => r.fam === d.f)) continue;
      out.push({ fam: d.f, minLevel: d.l, side: d.s, label: `${d.x.replace(/\n/g, ' / ')} (уже на предмете)`, group: -1 });
    }
    return out;
  }, [ctx, bought, unkept]);
  const keptFams = useMemo(() => new Set(kept.map((r) => r.fam)), [kept]);
  const userReqs = useMemo(() => reqs.filter((r) => !keptFams.has(r.fam)), [reqs, keptFams]);
  const mainCount = userReqs.filter((r) => !r.group).length;
  const effectiveNeed = need > 0 && need <= mainCount ? need : mainCount;
  const startItem = bought;

  const setup: Setup | null = useMemo(() => {
    if (!base || kept.length + userReqs.length === 0) return null;
    // free slots beyond the base's capacity are clamped
    const cap = ctx?.rareCap ?? { p: 3, s: 3 };
    const o = { p: Math.min(open.p, cap.p), s: Math.min(open.s, cap.s) };
    // kept modifiers form their own group: all of them must stay
    const gn: Record<string, number> = { '-1': kept.length };
    for (const g of [1, 2, 3]) gn[g] = groupNeed[g] ?? 1;
    const target = { reqs: [...kept, ...userReqs], need: effectiveNeed, groupNeed: gn, ...(o.p + o.s > 0 ? { open: o } : {}) };
    // a bought item: starting over means buying it again (at baseCost)
    return { baseId: base.id, ilvl, target, prices, baseCost, weights: effWeights, essences, ...(startItem ? { restartItem: startItem } : {}) };
  }, [base, ilvl, kept, userReqs, effectiveNeed, groupNeed, open, ctx, prices, baseCost, effWeights, essences, startItem]);

  const setupKey = setup ? JSON.stringify(setup) + JSON.stringify(startItem) : '';

  async function runEvaluation() {
    if (!setup || !client.current) return;
    setRunning(true);
    setResults([]);
    setTab('results');
    try {
      await client.current.evaluate(setup, trials, startItem, (r) => setResults((rs) => [...rs.filter((x) => x.strategyId !== r.strategyId), r]));
      setResultsFor(setupKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  if (error)
    return (
      <div className="app">
        <div className="card error">Ошибка: {error}</div>
      </div>
    );
  if (!data)
    return (
      <div className="app">
        <div className="card">Загружаю данные игры…</div>
      </div>
    );

  const tabs: [Tab, string][] = [
    ['goal', '1. Предмет и цель'],
    ['results', '2. Варианты крафта'],
    ['tracker', '3. Трекер крафта'],
    ['sandbox', 'Песочница'],
    ['prices', 'Цены'],
    ['weights', 'Веса модов'],
    ['help', 'Как это работает'],
  ];

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>PoE 2 · помощник по крафту</h1>
          <div className="muted small">
            Данные игры {data.meta.gameVersion} · цены:{' '}
            {pricesFile ? (
              <span className={priceAgeH > 6 ? 'warn-inline' : ''}>
                {pricesFile.league}, обновлены {priceAgeH < 1 ? `${Math.max(1, Math.round(priceAgeH * 60))} мин` : `${Math.round(priceAgeH)} ч`} назад
                {priceAgeH > 6 ? ' — устарели, проверьте вкладку «Цены»' : ''}
              </span>
            ) : (
              <span className="warn-inline">примерные (рыночные не загружены)</span>
            )}
          </div>
        </div>
        <label className="inline">
          Валюта:
          <select value={currency} onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}>
            <option value="ex">Сферы возвышения</option>
            <option value="div">Божественные сферы</option>
            <option value="chaos">Сферы хаоса</option>
          </select>
        </label>
      </header>

      <nav className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'goal' && (
        <>
          <ItemSetup
            bases={data.bases}
            classes={data.meta.classes}
            cls={cls}
            setCls={setCls}
            base={base}
            setBaseId={setBaseId}
            ilvl={ilvl}
            setIlvl={setIlvl}
            baseCost={baseCost}
            setBaseCost={setBaseCost}
            rareCap={ctx?.rareCap}
            fromItem={!!startItem}
          />
          <section className="card">
            <GameLink parser={parser} mode={linkMode} setMode={setLinkMode} onItem={applyGameItem} compact />
            <div className="muted small">Скопированный предмет (из игры или с сайта трейда) сразу выставит базу, уровень предмета и текущие моды.</div>
          </section>
          {ctx && startItem && (
            <CurrentItem
              ctx={ctx}
              families={families}
              item={bought!}
              info={itemInfo}
              unkept={unkept}
              setUnkept={setUnkept}
              onClear={() => {
                setTrackerItem({ rarity: 'normal', mods: [] });
                setBought(null);
                setItemInfo(null);
                setUnkept([]);
              }}
            />
          )}
          {ctx && (
            <TargetEditor
              families={families.filter((f) => !keptFams.has(f.fam))}
              reqs={userReqs}
              setReqs={setReqs}
              need={effectiveNeed}
              setNeed={setNeed}
              open={open}
              setOpen={setOpen}
              rareCap={ctx.rareCap}
              taken={{ p: kept.filter((r) => r.side === 'p').length, s: kept.filter((r) => r.side === 's').length }}
              groupNeed={groupNeed}
              setGroupNeed={setGroupNeed}
            />
          )}
          <div className="card actions">
            <label className="inline">
              Точность (попыток симуляции):
              <select value={trials} onChange={(e) => setTrials(+e.target.value)}>
                <option value={200}>200 — быстро</option>
                <option value={400}>400</option>
                <option value={1000}>1000 — точнее</option>
              </select>
            </label>
            <button className="primary" disabled={!setup || !ready || running} onClick={runEvaluation}>
              {running ? 'Считаю…' : 'Рассчитать варианты крафта'}
            </button>
            {!kept.length && !userReqs.length && <span className="muted">Добавьте хотя бы один желаемый мод.</span>}
            {startItem && <span className="muted small">Расчёт начнётся с текущего предмета.</span>}
          </div>
        </>
      )}

      {tab === 'results' && (
        <Results
          results={results}
          running={running}
          stale={!!resultsFor && resultsFor !== setupKey}
          currency={currency}
          prices={prices}
          onRecalc={runEvaluation}
          fromItem={!!startItem}
          onTrack={(id) => {
            setTrackerStrategy(id);
            setTab('tracker');
          }}
        />
      )}

      {tab === 'tracker' && ctx && setup && client.current && (
        <Tracker
          client={client.current}
          setup={setup}
          ctx={ctx}
          families={families}
          item={trackerItem}
          setItem={setTrackerItem}
          strategyId={trackerStrategy}
          setStrategyId={setTrackerStrategy}
          currency={currency}
          prices={prices}
          parser={parser}
          linkMode={linkMode}
          setLinkMode={setLinkMode}
          onBaseDetected={applyGameBase}
        />
      )}
      {tab === 'tracker' && !setup && (
        <div className="card">
          <p>Сначала выберите желаемые моды на вкладке «Предмет и цель». Базу можно взять прямо из игры:</p>
          <GameLink parser={parser} mode={linkMode} setMode={setLinkMode} onItem={applyGameItem} compact />
        </div>
      )}

      {tab === 'prices' && (
        <PricesPanel
          prices={prices}
          file={pricesFile}
          setFile={setPricesFile}
          refresh={refreshPrices}
          overrides={priceOverrides}
          setOverrides={setPriceOverrides}
          currency={currency}
        />
      )}

      {tab === 'sandbox' && ctx && <Sandbox ctx={ctx} families={families} currency={currency} prices={prices} />}
      {tab === 'weights' && ctx && <WeightsPanel
          families={families}
          weights={weights}
          setWeights={setWeights}
          community={community.weights}
          group={community.group}
          builtAt={data?.weights?.builtAt}
        />}

      {tab === 'help' && <HowItWorks />}

      <footer className="muted small">
        Данные: RePoE (выгрузка из клиента игры). Цены: poe.ninja. Проект не связан с Grinding Gear Games.
      </footer>
    </div>
  );
}
