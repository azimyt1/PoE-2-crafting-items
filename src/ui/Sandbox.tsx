// Sandbox: free crafting practice on the chosen base. Every click applies a
// currency with the same rules and weights the planner uses.

import { useMemo, useState } from 'react';
import { desecrationOptions, isValid, sample } from '../engine/actions';
import { actionCost, actionTitleRu, canDesecrate, omenRu } from '../engine/currency';
import { essencesForBase } from '../engine/essences';
import type { Action, ActionKind, BoneTier, Ctx, FluxKind, Item, ModDef, OmenName, OrbTier, Prices } from '../engine/types';
import { tierLabel, type Family } from './families';
import { fmtCost, type DisplayCurrency } from './format';

interface Props {
  ctx: Ctx;
  families: Family[];
  currency: DisplayCurrency;
  prices: Prices;
}

/** Which action each omen changes. */
const OMEN_FOR: Record<OmenName, ActionKind> = {
  'Omen of Sinistral Exaltation': 'exalt',
  'Omen of Dextral Exaltation': 'exalt',
  'Omen of Greater Exaltation': 'exalt',
  'Omen of Sinistral Coronation': 'regal',
  'Omen of Dextral Coronation': 'regal',
  'Omen of Sinistral Alchemy': 'alchemy',
  'Omen of Dextral Alchemy': 'alchemy',
  'Omen of Whittling': 'chaos',
  'Omen of Sinistral Erasure': 'chaos',
  'Omen of Dextral Erasure': 'chaos',
  'Omen of Sinistral Annulment': 'annul',
  'Omen of Dextral Annulment': 'annul',
  'Omen of Light': 'annul',
  'Omen of Sinistral Necromancy': 'desecrate',
  'Omen of Dextral Necromancy': 'desecrate',
  'Omen of Sinistral Crystallisation': 'essence',
  'Omen of Dextral Crystallisation': 'essence',
};

const ORBS: { kind: ActionKind; ru: string; tiered: boolean }[] = [
  { kind: 'transmute', ru: 'Превращение', tiered: true },
  { kind: 'augment', ru: 'Усиление', tiered: true },
  { kind: 'regal', ru: 'Регал', tiered: true },
  { kind: 'alchemy', ru: 'Алхимия', tiered: false },
  { kind: 'exalt', ru: 'Экзальт', tiered: true },
  { kind: 'chaos', ru: 'Хаос', tiered: true },
  { kind: 'annul', ru: 'Отмена', tiered: false },
  { kind: 'fracture', ru: 'Раскол', tiered: false },
];

const FLUXES: { flux: FluxKind; ru: string }[] = [
  { flux: 'Blazing', ru: 'Пылающий флюс' },
  { flux: 'Chilling', ru: 'Леденящий флюс' },
  { flux: 'Crackling', ru: 'Трескучий флюс' },
  { flux: 'Void', ru: 'Флюс Пустоты' },
];

const BONES: { bone: BoneTier; ru: string }[] = [
  { bone: 'Gnawed', ru: 'Обглоданная' },
  { bone: 'Preserved', ru: 'Сохранившаяся' },
  { bone: 'Ancient', ru: 'Древняя' },
];

interface Step {
  item: Item;
  spent: number;
}

export function Sandbox({ ctx, families, currency, prices }: Props) {
  const [item, setItem] = useState<Item>({ rarity: 'normal', mods: [] });
  const [spent, setSpent] = useState(0);
  const [history, setHistory] = useState<Step[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [tier, setTier] = useState<OrbTier>(0);
  const [omens, setOmens] = useState<OmenName[]>([]);
  const [msg, setMsg] = useState('');
  const [choice, setChoice] = useState<{ action: Action; options: ModDef[] } | null>(null);

  const famByFam = useMemo(() => new Map(families.map((f) => [f.fam, f])), [families]);
  const essences = useMemo(() => essencesForBase(ctx), [ctx]);
  const rng = Math.random;

  function describe(before: Item, after: Item): string {
    const b = before.mods.map((m) => m.id);
    const parts: string[] = [];
    for (const m of after.mods) {
      const k = b.indexOf(m.id);
      if (k >= 0) b.splice(k, 1);
      else parts.push('добавлен: ' + (ctx.byId.get(m.id)?.x.replace(/\n/g, ' / ') ?? m.id));
    }
    for (const id of b) parts.push('убран: ' + (ctx.byId.get(id)?.x.replace(/\n/g, ' / ') ?? id));
    const frBefore = before.mods.filter((m) => m.fr).length;
    if (after.mods.filter((m) => m.fr).length > frBefore) parts.push('мод расколот');
    return parts.join('; ') || (after.rarity !== before.rarity ? `теперь ${after.rarity}` : 'без изменений');
  }

  function commit(action: Action, next: Item) {
    const cost = action.kind === 'restart' ? ctx.baseCost : actionCost(action, ctx.base, prices, ctx.baseCost);
    setHistory((h) => [...h, { item, spent }].slice(-200));
    setSpent((s) => s + (Number.isFinite(cost) ? cost : 0));
    setLog((l) => [`${actionTitleRu(action, ctx.base)} → ${describe(item, next)}`, ...l].slice(0, 60));
    setItem(next);
    // omens are consumed by the action they change
    if (action.omens?.length) setOmens((o) => o.filter((x) => !action.omens!.includes(x)));
  }

  function apply(base: Action) {
    setMsg('');
    const action: Action = { ...base, omens: omens.filter((o) => OMEN_FOR[o] === base.kind) };
    if (action.kind === 'essence' && !action.essence?.rare) action.omens = [];
    if (!isValid(item, ctx, action)) {
      setMsg('Эту валюту сейчас нельзя применить к предмету (не та редкость, нет места или подходящих модов).');
      return;
    }
    if (action.kind === 'desecrate') {
      const options = desecrationOptions(item, ctx, action, rng);
      if (options.length) {
        setChoice({ action, options });
        return;
      }
    }
    commit(action, sample(item, ctx, action, rng));
  }

  function pickDesecrated(m: ModDef) {
    if (!choice) return;
    commit(choice.action, { rarity: item.rarity, mods: [...item.mods.map((x) => ({ ...x })), { id: m.id, de: true }] });
    setChoice(null);
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setItem(last.item);
    setSpent(last.spent);
    setHistory((h) => h.slice(0, -1));
    setLog((l) => ['(отмена хода)', ...l].slice(0, 60));
    setChoice(null);
  }

  function reset() {
    setItem({ rarity: 'normal', mods: [] });
    setSpent(0);
    setHistory([]);
    setLog([]);
    setChoice(null);
    setMsg('');
  }

  const toggleOmen = (o: OmenName) => setOmens((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]));
  const price = (a: Action) => fmtCost(actionCost(a, ctx.base, prices, ctx.baseCost), currency, prices);
  const tierWord = ['', 'Большая ', 'Совершенная '][tier];

  return (
    <section className="tracker">
      <div className="card">
        <h2>Песочница: бесплатный тестовый крафт</h2>
        <p className="muted small">
          База: <b>{ctx.base.name}</b>, уровень предмета {ctx.ilvl} (меняется во вкладке «Предмет и цель»). Валюты применяются по тем же правилам и
          весам, что использует планировщик. Настоящая игра не затрагивается.
        </p>
        <div className={'sandbox-item ' + item.rarity}>
          <div className="rarity">{item.rarity === 'normal' ? 'Обычный' : item.rarity === 'magic' ? 'Магический' : 'Редкий'} предмет</div>
          {item.mods.length === 0 && <div className="muted small">Модов нет</div>}
          {item.mods.map((m, i) => {
            const d = ctx.byId.get(m.id);
            if (!d) return null;
            const f = famByFam.get(d.f);
            return (
              <div key={i} className={'sbmod' + (m.fr ? ' fractured' : '') + (m.de ? ' desecrated' : '')}>
                <span className="muted small">{d.s === 'p' ? 'П' : 'С'}</span> {f ? tierLabel(f, d) : d.x}
                {m.fr ? ' · расколот' : ''}
                {m.de ? ' · очернён' : ''}
              </div>
            );
          })}
        </div>
        <div className="row">
          <span>
            Потрачено: <b>{fmtCost(spent, currency, prices)}</b>
          </span>
          <button onClick={undo} disabled={!history.length}>
            Отменить ход
          </button>
          <button className="ghost" onClick={reset}>
            Новая база
          </button>
        </div>
        {msg && <div className="warn">{msg}</div>}
        {choice && (
          <div className="card2">
            <b>Очернение: выберите один из раскрытых модов</b>
            {choice.options.map((m) => (
              <button key={m.id} className="fam" onClick={() => pickDesecrated(m)}>
                {m.s === 'p' ? 'П' : 'С'}: {m.x.replace(/\n/g, ' / ')} (ур. {m.l})
              </button>
            ))}
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

      <div className="card">
        <h2>Валюты</h2>
        <label className="inline">
          Сферы:
          <select value={tier} onChange={(e) => setTier(+e.target.value as OrbTier)}>
            <option value={0}>обычные</option>
            <option value={1}>большие (Greater)</option>
            <option value={2}>совершенные (Perfect)</option>
          </select>
        </label>
        <div className="sbbuttons">
          {ORBS.map((o) => {
            const a: Action = o.tiered ? { kind: o.kind, tier } : { kind: o.kind };
            return (
              <button key={o.kind} onClick={() => apply(a)} title={actionTitleRu(a, ctx.base)}>
                {o.tiered && tier ? tierWord : ''}
                {o.ru} <span className="muted small">{price(a)}</span>
              </button>
            );
          })}
        </div>
        <h3>Омены (срабатывают на следующей подходящей валюте)</h3>
        <div className="sbomens">
          {(Object.keys(OMEN_FOR) as OmenName[]).map((o) => (
            <label key={o} className="inline small">
              <input type="checkbox" checked={omens.includes(o)} onChange={() => toggleOmen(o)} /> {omenRu(o)}
            </label>
          ))}
        </div>
        <h3>Флюсы</h3>
        <div className="sbbuttons">
          {FLUXES.map((f) => (
            <button key={f.flux} onClick={() => apply({ kind: 'flux', flux: f.flux })}>
              {f.ru} <span className="muted small">{price({ kind: 'flux', flux: f.flux })}</span>
            </button>
          ))}
        </div>
        {canDesecrate(ctx.base) && (
          <>
            <h3>Кости Бездны (очернение)</h3>
            <div className="sbbuttons">
              {BONES.map((b) => (
                <button key={b.bone} onClick={() => apply({ kind: 'desecrate', bone: b.bone })}>
                  {b.ru} кость <span className="muted small">{price({ kind: 'desecrate', bone: b.bone })}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {essences.length > 0 && (
          <>
            <h3>Эссенции и сплавы для этой базы</h3>
            <div className="sbbuttons">
              {essences.map((e) => {
                const a: Action = { kind: 'essence', essence: { name: e.name, modIds: e.mods.map((m) => m.id), rare: e.rare } };
                return (
                  <button key={e.name} onClick={() => apply(a)} title={e.mods.map((m) => m.x.replace(/\n/g, ' / ')).join(' или ')}>
                    {e.ru} <span className="muted small">{e.rare ? 'редкий' : 'магический'} · {price(a)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
