import { useEffect, useMemo, useState } from 'react';
import type { Advice, Setup } from '../api';
import { STRATEGIES } from '../engine/strategies';
import type { Ctx, Item, ItemMod, Prices, Rarity } from '../engine/types';
import { tierLabel, type Family } from './families';
import { fmtCost, fmtPct, type DisplayCurrency } from './format';
import { PlanSteps } from './Results';
import type { WorkerClient } from './workerClient';

interface Props {
  client: WorkerClient;
  setup: Setup;
  ctx: Ctx;
  families: Family[];
  item: Item;
  setItem: (i: Item) => void;
  strategyId: string;
  setStrategyId: (s: string) => void;
  currency: DisplayCurrency;
  prices: Prices;
}

export function Tracker(p: Props) {
  const { ctx, item, setItem, currency, prices } = p;
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [spent, setSpent] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [famSel, setFamSel] = useState('');
  const [tierSel, setTierSel] = useState('');
  const [q, setQ] = useState('');

  const setupKey = JSON.stringify(p.setup);
  const itemKey = JSON.stringify(item);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErr(null);
    p.client
      .advise(p.setup, p.strategyId, item, 200)
      .then((a) => !cancelled && setAdvice(a))
      .catch((e) => !cancelled && setErr(String(e.message ?? e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupKey, itemKey, p.strategyId]);

  const famByFam = useMemo(() => new Map(p.families.map((f) => [f.fam, f])), [p.families]);
  const onItem = new Set(item.mods.map((m) => ctx.byId.get(m.id)?.f));
  const cap = item.rarity === 'magic' ? { p: 1, s: 1 } : item.rarity === 'rare' ? ctx.rareCap : { p: 0, s: 0 };
  const count = { p: 0, s: 0 };
  for (const m of item.mods) count[ctx.byId.get(m.id)!.s]++;
  const addable = p.families.filter(
    (f) => !onItem.has(f.fam) && count[f.side] < cap[f.side] && (!q || f.name.toLowerCase().includes(q.toLowerCase())),
  );
  const selFam = famByFam.get(famSel);

  function setRarity(r: Rarity) {
    if (r === 'normal') setItem({ rarity: r, mods: [] });
    else if (r === 'magic') setItem({ rarity: r, mods: item.mods.slice(0, 2) });
    else setItem({ ...item, rarity: r });
  }

  function addMod() {
    if (!selFam) return;
    const id = tierSel || selFam.tiers[0].id;
    setItem({ ...item, mods: [...item.mods, { id }] });
    setFamSel('');
    setTierSel('');
  }

  function patchMod(i: number, patch: Partial<ItemMod>) {
    setItem({ ...item, mods: item.mods.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  }

  async function simulateStep() {
    if (!advice?.action) return;
    try {
      const next = await p.client.roll(p.setup, p.strategyId, item, advice.action);
      setSpent((s) => s + (advice.cost ?? 0));
      setLog((l) => [`${advice.title}`, ...l].slice(0, 30));
      setItem(next);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }

  function markDone() {
    if (!advice?.action) return;
    setSpent((s) => s + (advice.cost ?? 0));
    setLog((l) => [`(в игре) ${advice.title}`, ...l].slice(0, 30));
    if (advice.action.kind === 'restart') setItem({ rarity: 'normal', mods: [] });
  }

  return (
    <section className="tracker">
      <div className="card">
        <h2>Текущее состояние предмета</h2>
        <p className="muted small">
          Внесите то, что сейчас на предмете в игре. После каждого действия в игре обновляйте моды здесь: помощник пересчитает шансы и
          подскажет следующий шаг или запасной план.
        </p>
        <div className="grid">
          <label>
            Редкость
            <select value={item.rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
              <option value="normal">Обычный (белый)</option>
              <option value="magic">Магический (синий)</option>
              <option value="rare">Редкий (жёлтый)</option>
            </select>
          </label>
          <label>
            Стратегия
            <select value={p.strategyId} onChange={(e) => p.setStrategyId(e.target.value)}>
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <table className="mods">
          <tbody>
            {item.mods.map((m, i) => {
              const d = ctx.byId.get(m.id);
              if (!d) return null;
              const f = famByFam.get(d.f);
              return (
                <tr key={i}>
                  <td>{d.s === 'p' ? 'Префикс' : 'Суффикс'}</td>
                  <td>
                    {f ? (
                      <select value={m.id} onChange={(e) => patchMod(i, { id: e.target.value })}>
                        {f.tiers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {tierLabel(f, t)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      d.x
                    )}
                  </td>
                  <td className="nowrap small">
                    <label className="inline">
                      <input type="checkbox" checked={!!m.fr} onChange={(e) => patchMod(i, { fr: e.target.checked })} /> расколот
                    </label>{' '}
                    <label className="inline">
                      <input type="checkbox" checked={!!m.de} onChange={(e) => patchMod(i, { de: e.target.checked })} /> осквернён
                    </label>
                  </td>
                  <td>
                    <button className="ghost" onClick={() => setItem({ ...item, mods: item.mods.filter((_, k) => k !== i) })}>
                      Убрать
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {item.rarity !== 'normal' && (
          <div className="addmod">
            <input placeholder="Поиск мода" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={famSel} onChange={(e) => setFamSel(e.target.value)}>
              <option value="">— выберите мод —</option>
              {addable.map((f) => (
                <option key={f.fam} value={f.fam}>
                  {f.side === 'p' ? 'П' : 'С'}: {f.name}
                </option>
              ))}
            </select>
            {selFam && (
              <select value={tierSel} onChange={(e) => setTierSel(e.target.value)}>
                {selFam.tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {tierLabel(selFam, t)}
                  </option>
                ))}
              </select>
            )}
            <button disabled={!selFam} onClick={addMod}>
              Добавить мод
            </button>
          </div>
        )}
        <div className="muted small">
          Слоты: префиксы {count.p}/{cap.p}, суффиксы {count.s}/{cap.s}. Потрачено в этой сессии: {fmtCost(spent, currency, prices)}.{' '}
          <button
            className="ghost"
            onClick={() => {
              setItem({ rarity: 'normal', mods: [] });
              setSpent(0);
              setLog([]);
            }}
          >
            Начать заново
          </button>
        </div>
      </div>

      <div className="card advice">
        <h2>Что делать дальше</h2>
        {err && <div className="error">{err}</div>}
        {busy && !advice && <p className="muted">Считаю…</p>}
        {advice && (
          <div className={busy ? 'dim' : ''}>
            {advice.done && <p className="good big">Цель достигнута! Предмет готов.</p>}
            {advice.impossible && (
              <p className="warn">Из этого состояния цель недостижима выбранной стратегией (например, мешает расколотый мод). Возьмите новую базу.</p>
            )}
            {!advice.done && !advice.impossible && advice.title && (
              <>
                <p className="big">
                  <b>{advice.title}</b>
                </p>
                <p className="small">
                  Стоимость шага: {fmtCost(advice.cost ?? 0, currency, prices)} · ожидаемо до готового предмета:{' '}
                  <b>{fmtCost(advice.remaining, currency, prices)}</b>
                  {advice.sim && (
                    <>
                      {' '}
                      · по симуляции {fmtCost(advice.sim.meanCost, currency, prices)} (в 9 из 10 случаев до {fmtCost(advice.sim.p90Cost, currency, prices)})
                    </>
                  )}
                </p>
                {advice.outcomes.length > 0 && (
                  <>
                    <h3>Возможные исходы этого шага</h3>
                    <ul className="outcomes">
                      {advice.outcomes.map((o, i) => (
                        <li key={i} className={o.good ? 'good' : 'bad'}>
                          <b>{fmtPct(o.p)}</b> — {o.label}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="row">
                  <button className="primary" onClick={simulateStep}>
                    Смоделировать бросок
                  </button>
                  <button onClick={markDone}>Сделал в игре (учесть расход)</button>
                </div>
                <h3>Другие варианты</h3>
                <table className="alts">
                  <tbody>
                    {advice.alternatives.map((a, i) => (
                      <tr key={i}>
                        <td>{a.title}</td>
                        <td className="nowrap">{fmtCost(a.value, currency, prices)} до цели</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>Дальнейший план (если повезёт)</h3>
                <PlanSteps steps={advice.plan} currency={currency} prices={prices} />
              </>
            )}
          </div>
        )}
        {log.length > 0 && (
          <>
            <h3>Журнал</h3>
            <ol className="log small">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
