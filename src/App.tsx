import { useEffect, useMemo, useRef, useState } from 'react';
import type { Setup, StrategyResult } from './api';
import { DEFAULT_PRICES } from './engine/currency';
import { DEFAULT_ESSENCE_PRICES } from './engine/essences';
import { buildCtx } from './engine/item';
import type { BaseDef, Item, ModDef, Prices, TargetReq } from './engine/types';
import { familiesOf } from './ui/families';
import type { DisplayCurrency } from './ui/format';
import { ItemSetup } from './ui/ItemSetup';
import { TargetEditor } from './ui/TargetEditor';
import { Results } from './ui/Results';
import { Tracker } from './ui/Tracker';
import { PricesPanel, type PricesFile } from './ui/PricesPanel';
import { WeightsPanel } from './ui/WeightsPanel';
import { HowItWorks } from './ui/HowItWorks';
import { WorkerClient } from './ui/workerClient';

interface Meta {
  gameVersion: string;
  builtAt: string;
  classes: Record<string, string>;
}

interface Saved {
  cls: string;
  baseId: string;
  ilvl: number;
  baseCost: number;
  reqs: TargetReq[];
  need: number;
  priceOverrides: Prices;
  weights: Record<string, number>;
  currency: DisplayCurrency;
  trials: number;
}

const STORE_KEY = 'poe2craft:v1';

function loadSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

type Tab = 'goal' | 'results' | 'tracker' | 'prices' | 'weights' | 'help';

export default function App() {
  const saved = useMemo(loadSaved, []);
  const [data, setData] = useState<{ bases: BaseDef[]; mods: ModDef[]; meta: Meta; pricesFile: PricesFile | null } | null>(null);
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
  const [priceOverrides, setPriceOverrides] = useState<Prices>(saved.priceOverrides ?? {});
  const [weights, setWeights] = useState<Record<string, number>>(saved.weights ?? {});
  const [currency, setCurrency] = useState<DisplayCurrency>(saved.currency ?? 'ex');
  const [trials, setTrials] = useState(saved.trials ?? 400);

  const [results, setResults] = useState<StrategyResult[]>([]);
  const [running, setRunning] = useState(false);
  const [resultsFor, setResultsFor] = useState('');
  const [trackerItem, setTrackerItem] = useState<Item>({ rarity: 'normal', mods: [] });
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
        setData({ bases, mods, meta, pricesFile });
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
      const s: Saved = { cls, baseId, ilvl, baseCost, reqs, need, priceOverrides, weights, currency, trials };
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }, [cls, baseId, ilvl, baseCost, reqs, need, priceOverrides, weights, currency, trials]);

  const prices: Prices = useMemo(
    () => ({ ...DEFAULT_PRICES, ...DEFAULT_ESSENCE_PRICES, ...(data?.pricesFile?.prices ?? {}), ...priceOverrides }),
    [data, priceOverrides],
  );

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

  const ctx = useMemo(() => {
    if (!data || !base) return null;
    return buildCtx({ base, ilvl, mods: data.mods, prices, baseCost, weightOverrides: weights });
  }, [data, base, ilvl, prices, baseCost, weights]);

  const families = useMemo(() => (ctx ? familiesOf(ctx) : []), [ctx]);

  // drop reqs that are not available on the new base
  useEffect(() => {
    if (!families.length) return;
    const avail = new Set(families.map((f) => f.fam));
    setReqs((rs) => (rs.every((r) => avail.has(r.fam)) ? rs : rs.filter((r) => avail.has(r.fam))));
  }, [families]);

  const effectiveNeed = need > 0 && need <= reqs.length ? need : reqs.length;

  const setup: Setup | null = useMemo(() => {
    if (!base || !reqs.length) return null;
    return { baseId: base.id, ilvl, target: { reqs, need: effectiveNeed }, prices, baseCost, weights };
  }, [base, ilvl, reqs, effectiveNeed, prices, baseCost, weights]);

  const setupKey = setup ? JSON.stringify(setup) : '';

  async function runEvaluation() {
    if (!setup || !client.current) return;
    setRunning(true);
    setResults([]);
    setTab('results');
    try {
      await client.current.evaluate(setup, trials, (r) => setResults((rs) => [...rs.filter((x) => x.strategyId !== r.strategyId), r]));
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
            Данные игры {data.meta.gameVersion} · цены: {data.pricesFile ? `${data.pricesFile.league}, ${new Date(data.pricesFile.updatedAt).toLocaleString('ru-RU')}` : 'примерные (не загружены)'}
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
          />
          {ctx && (
            <TargetEditor families={families} reqs={reqs} setReqs={setReqs} need={effectiveNeed} setNeed={setNeed} rareCap={ctx.rareCap} />
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
            {!reqs.length && <span className="muted">Добавьте хотя бы один желаемый мод.</span>}
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
        />
      )}
      {tab === 'tracker' && !setup && <div className="card">Сначала выберите базу и желаемые моды на вкладке «Предмет и цель».</div>}

      {tab === 'prices' && (
        <PricesPanel prices={prices} file={data.pricesFile} overrides={priceOverrides} setOverrides={setPriceOverrides} currency={currency} />
      )}

      {tab === 'weights' && ctx && <WeightsPanel families={families} weights={weights} setWeights={setWeights} />}

      {tab === 'help' && <HowItWorks />}

      <footer className="muted small">
        Данные: RePoE (выгрузка из клиента игры). Цены: poe.ninja. Проект не связан с Grinding Gear Games.
      </footer>
    </div>
  );
}
