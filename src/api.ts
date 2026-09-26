// Messages between the UI and the calculation worker.

import type { Action, BaseDef, EssenceDef, Item, ModDef, Prices, Target } from './engine/types';

export interface Setup {
  baseId: string;
  ilvl: number;
  target: Target;
  prices: Prices;
  baseCost: number;
  weights: Record<string, number>;
  /** essences and alloys usable on this base */
  essences: EssenceDef[];
  /** crafting a bought item: starting over means buying it again */
  restartItem?: Item;
}

export interface StrategyResult {
  strategyId: string;
  name: string;
  description: string;
  estimate: number;
  successRate: number;
  meanCost: number;
  medianCost: number;
  p90Cost: number;
  meanSteps: number;
  meanRestarts: number;
  firstBaseSuccess: number;
  usage: [string, number][];
  plan: PlanStepView[];
  impossible: boolean;
}

export interface PlanStepView {
  title: string;
  cost: number;
  pGood: number;
  fallback?: string;
  pFallback?: number;
  remaining: number;
  itemAfter: string[];
}

export interface OutcomeView {
  p: number;
  label: string;
  good: boolean;
}

export interface Advice {
  done: boolean;
  impossible: boolean;
  remaining: number;
  action?: Action;
  title?: string;
  cost?: number;
  alternatives: { title: string; value: number; cost: number; action: Action }[];
  outcomes: OutcomeView[];
  sim?: { successRate: number; meanCost: number; p90Cost: number };
  plan: PlanStepView[];
}

export type WorkerRequest =
  | { type: 'init'; mods: ModDef[]; bases: BaseDef[]; ru?: Record<string, string> }
  | { type: 'evaluate'; id: number; setup: Setup; trials: number; strategyIds?: string[]; start?: Item }
  | { type: 'advise'; id: number; setup: Setup; strategyId: string; item: Item; trials: number }
  | { type: 'roll'; id: number; setup: Setup; strategyId: string; item: Item; action: Action; seed: number };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'strategy'; id: number; result: StrategyResult }
  | { type: 'evaluated'; id: number }
  | { type: 'advice'; id: number; advice: Advice }
  | { type: 'rolled'; id: number; item: Item }
  | { type: 'error'; id: number; message: string };
