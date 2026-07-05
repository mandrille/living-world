import { Faction } from './types';
import { pick } from './rng';
import { factionName, factionMyth, settlementName, ETHOS, GOVERNMENTS, LEADER_TITLES } from './names';

const COLORS = ['#e06a6a', '#6ab4e0', '#7fd17f', '#e0c76a', '#c98fe0', '#e09a5f', '#6fe0cd', '#b9c4d6'];
const SYMBOLS = ['♠', '♦', '☼', '♣', '♥', '♪', '☿', '♁'];

export function makeFaction(id: number, hallX: number, hallY: number): Faction {
  return {
    id,
    name: factionName(),
    color: COLORS[id % COLORS.length],
    symbol: SYMBOLS[id % SYMBOLS.length],
    ethos: pick(ETHOS),
    myth: factionMyth(),
    government: pick(GOVERNMENTS),
    settlement: settlementName(),
    leaderTitle: pick(LEADER_TITLES),
    leaderId: null,
    hallX,
    hallY,
    stock: { food: 60, wood: 30, stone: 10, metal: 0 },
    relations: {},
    popHistory: [],
    scoreHistory: [],
    research: { branch: null, progress: 0, done: [] },
    alive: true,
    warsWon: 0,
    warsLost: 0,
  };
}

export function relationLabel(v: number): { label: string; cls: string } {
  if (v <= -60) return { label: 'hated enemy', cls: 'bad' };
  if (v <= -25) return { label: 'hostile', cls: 'bad' };
  if (v < 25) return { label: 'wary', cls: 'muted' };
  if (v < 60) return { label: 'cordial', cls: 'good' };
  return { label: 'close ally', cls: 'good' };
}
