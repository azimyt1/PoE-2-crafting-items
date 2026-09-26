// Crafting items for display: official Russian name, icon and a detailed
// Russian description of what the item does.
// Names and icons: public/data/currency.json (Exiled Exchange 2, MIT) plus
// icons from poe.ninja for items that list lacks.

import { essenceRu } from '../engine/essences';

interface Info {
  ru?: string;
  icon?: string;
}

let info: Record<string, Info> = {};

export function setItemData(items: Record<string, Info> | undefined, ninjaIcons?: Record<string, string>): void {
  info = { ...(items ?? {}) };
  for (const [name, icon] of Object.entries(ninjaIcons ?? {})) {
    if (!info[name]) info[name] = {};
    if (!info[name].icon) info[name].icon = icon;
  }
}

const FLUX_RU: Record<string, string> = {
  'Blazing Flux': 'Пылающий флюс',
  'Chilling Flux': 'Леденящий флюс',
  'Crackling Flux': 'Трескучий флюс',
  'Void Flux': 'Флюс Пустоты',
};

/** Official Russian name (or our translation when the client list lacks it). */
export function itemRu(name: string): string {
  return info[name]?.ru ?? FLUX_RU[name] ?? (/Essence|Alloy/.test(name) ? essenceRu(name) : name);
}

export function ItemIcon({ name, size = 28 }: { name: string; size?: number }) {
  const src = info[name]?.icon;
  if (!src) return <span className="item-icon placeholder" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="item-icon" src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />;
}

// ------------------------------------------------------------ descriptions

const ORB_TIER: Record<string, string> = {
  Greater: 'Большая версия: новый мод будет не ниже заданного уровня мода (',
  Perfect: 'Совершенная версия: новый мод будет не ниже заданного уровня мода (',
};

const OMENS: Record<string, string> = {
  'Omen of Sinistral Exaltation': 'Следующая сфера возвышения добавит только префикс.',
  'Omen of Dextral Exaltation': 'Следующая сфера возвышения добавит только суффикс.',
  'Omen of Greater Exaltation': 'Следующая сфера возвышения добавит сразу два мода. Можно сочетать с оменом «только префиксы / только суффиксы».',
  'Omen of Sinistral Coronation': 'Следующая сфера царей (регал) добавит только префикс.',
  'Omen of Dextral Coronation': 'Следующая сфера царей (регал) добавит только суффикс.',
  'Omen of Sinistral Alchemy': 'Следующая сфера алхимии даст максимально возможное число префиксов.',
  'Omen of Dextral Alchemy': 'Следующая сфера алхимии даст максимально возможное число суффиксов.',
  'Omen of Whittling': 'Следующая сфера хаоса уберёт мод с самым низким уровнем (обычно самый слабый), а не случайный.',
  'Omen of Sinistral Erasure': 'Следующая сфера хаоса уберёт только префикс (новый мод при этом случайный).',
  'Omen of Dextral Erasure': 'Следующая сфера хаоса уберёт только суффикс (новый мод при этом случайный).',
  'Omen of Sinistral Annulment': 'Следующая сфера отмены уберёт только префикс.',
  'Omen of Dextral Annulment': 'Следующая сфера отмены уберёт только суффикс.',
  'Omen of Light': 'Следующая сфера отмены уберёт только очернённый мод (если он есть).',
  'Omen of Sinistral Necromancy': 'Следующая кость Бездны добавит очернённый мод только в префиксы.',
  'Omen of Dextral Necromancy': 'Следующая кость Бездны добавит очернённый мод только в суффиксы.',
  'Omen of Sinistral Crystallisation': 'Следующая совершенная или «проклятая» сущность уберёт только префикс (а не случайный мод).',
  'Omen of Dextral Crystallisation': 'Следующая совершенная или «проклятая» сущность уберёт только суффикс (а не случайный мод).',
};

const BASIC: Record<string, string> = {
  'Orb of Transmutation': 'Обычный (белый) предмет → магический с одним случайным модом.',
  'Orb of Augmentation': 'Добавляет случайный мод магическому предмету, если на нём только один мод (максимум 1 префикс и 1 суффикс).',
  'Regal Orb': 'Магический предмет → редкий, добавляя один случайный мод. Старые моды остаются.',
  'Orb of Alchemy': 'Обычный предмет → редкий сразу с четырьмя случайными модами.',
  'Exalted Orb': 'Добавляет один случайный мод редкому предмету, если есть свободное место (обычно до 3 префиксов и 3 суффиксов).',
  'Chaos Orb': 'Убирает один случайный мод редкого предмета и добавляет один новый случайный мод. Расколотые моды не убираются.',
  'Orb of Annulment': 'Убирает один случайный мод с магического или редкого предмета. Расколотые моды не убираются.',
  'Fracturing Orb':
    'Навсегда закрепляет (раскалывает) один случайный мод редкого предмета, если на нём 4 мода или больше. Расколотый мод нельзя убрать ни отменой, ни хаосом. На уже расколотый предмет не действует.',
  'Divine Orb': 'Перебрасывает значения модов в пределах их тиров. Сами моды не меняются.',
};

const FLUX: Record<string, string> = {
  'Blazing Flux': 'Превращает все моды сопротивления холоду и молнии в сопротивление огню того же тира.',
  'Chilling Flux': 'Превращает все моды сопротивления огню и молнии в сопротивление холоду того же тира.',
  'Crackling Flux': 'Превращает все моды сопротивления огню и холоду в сопротивление молнии того же тира.',
  'Void Flux': 'Превращает все моды сопротивления стихиям (огонь, холод, молния) в сопротивление хаосу.',
};

const MIN_LEVEL: Record<string, [number, number]> = {
  'Orb of Transmutation': [44, 70],
  'Orb of Augmentation': [44, 70],
  'Regal Orb': [35, 50],
  'Exalted Orb': [35, 50],
  'Chaos Orb': [35, 50],
};

/** Detailed Russian description of a crafting item. `adds` lists what an essence adds on this base. */
export function describeItem(name: string, adds?: string[]): string {
  if (OMENS[name]) return `Предзнаменование (омен): активируйте его в инвентаре. ${OMENS[name]} Тратится при срабатывании.`;
  if (FLUX[name]) return FLUX[name];
  const tiered = name.match(/^(Greater|Perfect) (.+)$/);
  if (tiered && BASIC[tiered[2]] && MIN_LEVEL[tiered[2]]) {
    const lv = MIN_LEVEL[tiered[2]][tiered[1] === 'Greater' ? 0 : 1];
    return `${BASIC[tiered[2]]} ${ORB_TIER[tiered[1]]}${lv}+), поэтому низкие тиры не выпадут.`;
  }
  if (BASIC[name]) return BASIC[name];
  const bone = name.match(/^(Gnawed|Preserved|Ancient|Altered) (Jawbone|Rib|Collarbone)$/);
  if (bone) {
    const what = bone[2] === 'Jawbone' ? 'оружие или колчан' : bone[2] === 'Rib' ? 'броню' : 'амулет, кольцо или пояс';
    const lv =
      bone[1] === 'Gnawed' ? 'Моды не выше 64 уровня.' : bone[1] === 'Ancient' ? 'Моды не ниже 40 уровня.' : bone[1] === 'Altered' ? 'С шансом на особые моды.' : '';
    return `Очерняет редкий предмет (${what}): добавляет скрытый мод, при раскрытии вы выбираете один из 3 вариантов (могут быть моды лордов Бездны). ${lv} На предмете может быть только один очернённый мод.`;
  }
  if (/Essence|Alloy/.test(name)) {
    const rare = /^Perfect |Alloy$|^Essence of (Delirium|Horror|Hysteria|Insanity)$/.test(name);
    const what = adds?.length ? ` Добавляет: ${adds.join(' или ')}.` : '';
    return rare
      ? `Для редкого предмета: убирает случайный мод и добавляет гарантированный.${what} Омены кристаллизации позволяют убирать только префикс или суффикс (для совершенных и «проклятых» сущностей).`
      : `Магический предмет → редкий с гарантированным модом.${what}`;
  }
  return '';
}

/** Tooltip: Russian name, English name, description. */
export function itemTitle(name: string, adds?: string[]): string {
  const ru = itemRu(name);
  const d = describeItem(name, adds);
  return `${ru}${ru !== name ? ` (${name})` : ''}${d ? `\n\n${d}` : ''}`;
}
