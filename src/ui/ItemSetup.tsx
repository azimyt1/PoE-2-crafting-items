import type { BaseDef } from '../engine/types';

interface Props {
  bases: BaseDef[];
  classes: Record<string, string>;
  cls: string;
  setCls: (c: string) => void;
  base: BaseDef | null;
  setBaseId: (id: string) => void;
  ilvl: number;
  setIlvl: (n: number) => void;
  baseCost: number;
  setBaseCost: (n: number) => void;
  rareCap?: { p: number; s: number };
  /** crafting a bought item: the price is that of buying it again */
  fromItem?: boolean;
}

export function ItemSetup(p: Props) {
  const list = p.bases.filter((b) => b.cls === p.cls);
  return (
    <section className="card">
      <h2>Предмет</h2>
      <div className="grid">
        <label>
          Тип предмета
          <select value={p.cls} onChange={(e) => p.setCls(e.target.value)}>
            {Object.entries(p.classes).map(([k, ru]) => (
              <option key={k} value={k}>
                {ru} ({k})
              </option>
            ))}
          </select>
        </label>
        <label>
          База
          <select value={p.base?.id ?? ''} onChange={(e) => p.setBaseId(e.target.value)}>
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (ур. {b.lvl}){b.imp.length ? ' — ' + b.imp.join('; ').replace(/\n/g, ', ').slice(0, 60) : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Уровень предмета (ilvl)
          <input type="number" min={1} max={100} value={p.ilvl} onChange={(e) => p.setIlvl(Math.max(1, Math.min(100, +e.target.value || 1)))} />
        </label>
        <label>
          {p.fromItem ? 'Цена такого же предмета на трейде (в сферах возвышения)' : 'Цена одной базы (в сферах возвышения)'}
          <input type="number" min={0} step={0.1} value={p.baseCost} onChange={(e) => p.setBaseCost(Math.max(0, +e.target.value || 0))} />
        </label>
      </div>
      {p.base && (
        <div className="muted small">
          {p.base.imp.length ? <>Свойство базы: {p.base.imp.join('; ')}. </> : null}
          {p.rareCap && (
            <>
              Редкий предмет: до {p.rareCap.p} префиксов и {p.rareCap.s} суффиксов.
            </>
          )}
        </div>
      )}
    </section>
  );
}
