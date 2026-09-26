// The item being crafted (pasted from the game or the trade site): what is
// on it now, and which of its modifiers the target must keep.

import type { Ctx, Item } from '../engine/types';
import { tierLabel, tierLabelEn, type Family } from './families';
import { ruText } from '../engine/ruText';

/** What the parser saw besides the modifiers (display only). */
export interface ItemInfo {
  name?: string;
  baseName: string;
  ilvl: number | null;
  props: string[];
  implicits: string[];
  runes: string[];
  corrupted: boolean;
}

interface Props {
  ctx: Ctx;
  families: Family[];
  item: Item;
  info: ItemInfo | null;
  /** ids of modifiers the user does not want to keep */
  unkept: string[];
  setUnkept: (ids: string[]) => void;
  onClear: () => void;
}

const RARITY_RU = { normal: 'Обычный', magic: 'Магический', rare: 'Редкий' };

export function CurrentItem({ ctx, families, item, info, unkept, setUnkept, onClear }: Props) {
  const famByFam = new Map(families.map((f) => [f.fam, f]));
  const cap = item.rarity === 'magic' ? { p: 1, s: 1 } : item.rarity === 'rare' ? ctx.rareCap : { p: 0, s: 0 };
  const mods = item.mods.map((m) => ({ m, d: ctx.byId.get(m.id) })).filter((x) => x.d);
  const count = { p: 0, s: 0 };
  for (const x of mods) count[x.d!.s]++;

  const row = (side: 'p' | 's') =>
    mods
      .filter((x) => x.d!.s === side)
      .map(({ m, d }) => {
        const f = famByFam.get(d!.f);
        const keep = !unkept.includes(m.id);
        return (
          <li key={m.id} className={(m.fr ? 'fractured ' : '') + (m.de ? 'desecrated' : '')}>
            <label className="inline" title={f ? tierLabelEn(f, d!) : d!.x}>
              <input
                type="checkbox"
                checked={keep}
                onChange={() => setUnkept(keep ? [...unkept, m.id] : unkept.filter((x) => x !== m.id))}
                title="Сохранить этот мод в цели"
              />{' '}
              {f ? tierLabel(f, d!) : ruText(d!.x)}
              {m.fr ? ' · расколот' : ''}
              {m.de ? ' · очернён' : ''}
            </label>
          </li>
        );
      });

  return (
    <section className="card current-item">
      <div className="row">
        <h2>Текущий предмет</h2>
        <button className="ghost" onClick={onClear}>
          Убрать предмет (крафт с чистой базы)
        </button>
      </div>
      <div className={'sandbox-item ' + item.rarity}>
        {info?.name && <div className="rarity">{info.name}</div>}
        <div className="rarity">{info?.baseName || ctx.base.name}</div>
        <div className="muted small">
          {RARITY_RU[item.rarity]} · уровень предмета {info?.ilvl ?? ctx.ilvl}
          {info?.corrupted ? ' · осквернён (крафт невозможен)' : ''}
        </div>
        {!!info?.props.length && (
          <div className="small props">
            {info.props.map((p, i) => (
              <div key={i}>{p}</div>
            ))}
          </div>
        )}
        {!!info?.implicits.length && (
          <div className="small implicit">
            {info.implicits.map((p, i) => (
              <div key={i}>{p} (собственный мод базы)</div>
            ))}
          </div>
        )}
        {!!info?.runes.length && (
          <div className="small rune">
            {info.runes.map((p, i) => (
              <div key={i}>{p} (руна)</div>
            ))}
          </div>
        )}
      </div>
      <div className="grid2">
        <div>
          <h3>
            Префиксы {count.p}/{cap.p}
          </h3>
          <ul className="curmods">{row('p')}</ul>
          {count.p === 0 && <div className="muted small">нет</div>}
        </div>
        <div>
          <h3>
            Суффиксы {count.s}/{cap.s}
          </h3>
          <ul className="curmods">{row('s')}</ul>
          {count.s === 0 && <div className="muted small">нет</div>}
        </div>
      </div>
      <p className="muted small">
        Отмеченные моды войдут в цель: планировщик их сохранит, и в списке ниже их нет. Снимите отметку, если мод не нужен (его можно
        убрать) или вы хотите тир выше — тогда он снова появится в списке.
      </p>
    </section>
  );
}
