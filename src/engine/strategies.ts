// Preset crafting strategies. Each one limits which currencies the planner
// may use, so they can be compared side by side.

import type { Strategy } from './types';

const none = {
  augment: false,
  regal: false,
  exalt: false,
  chaos: false,
  annul: false,
  essence: false,
  desecrate: false,
  omens: false,
  higherTiers: false,
  restart: true,
};

export const STRATEGIES: Strategy[] = [
  {
    id: 'basic',
    name: 'Базовые валюты',
    description:
      'Превращение → усиление → регал → экзальты. Плохой мод убираем сферой отмены или берём новую базу. Без оменов и улучшенных сфер.',
    start: 'transmute',
    allow: { ...none, augment: true, regal: true, exalt: true, annul: true },
  },
  {
    id: 'omens',
    name: 'Экзальты с оменами',
    description:
      'То же, но с оменами (только префикс или только суффикс) и Большими/Совершенными сферами, которые отсекают низкие тиры.',
    start: 'transmute',
    allow: { ...none, augment: true, regal: true, exalt: true, annul: true, omens: true, higherTiers: true },
  },
  {
    id: 'essence',
    name: 'Эссенция + экзальты',
    description:
      'Магический предмет превращается в редкий эссенцией с гарантированным нужным модом, дальше экзальты с оменами.',
    start: 'transmute',
    allow: { ...none, augment: true, regal: true, exalt: true, annul: true, essence: true, omens: true, higherTiers: true },
  },
  {
    id: 'chaos',
    name: 'Алхимия + хаос',
    description: 'Сфера алхимии сразу даёт редкий предмет с 4 модами, дальше сферы хаоса (с оменами строгания/стирания) и экзальты.',
    start: 'alchemy',
    allow: { ...none, exalt: true, chaos: true, omens: true, higherTiers: true },
  },
  {
    id: 'desecrate',
    name: 'Осквернение (кости Бездны)',
    description:
      'Экзальты и эссенции плюс кости: осквернённый мод выбирается из 3 вариантов. Омен света позволяет снять только осквернённый мод.',
    start: 'transmute',
    allow: { ...none, augment: true, regal: true, exalt: true, annul: true, essence: true, desecrate: true, omens: true, higherTiers: true },
  },
  {
    id: 'full',
    name: 'Всё доступное',
    description: 'Планировщик сам выбирает любую валюту на каждом шаге.',
    start: 'transmute',
    allow: {
      augment: true,
      regal: true,
      exalt: true,
      chaos: true,
      annul: true,
      essence: true,
      desecrate: true,
      omens: true,
      higherTiers: true,
      restart: true,
    },
  },
];
