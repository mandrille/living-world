import { Agent, Role } from './types';
import { ri, pick, chance, shuffle } from './rng';
import { givenName, surname, PERSONALITY, APPEARANCE, BELIEFS } from './names';
import { makeBody, weather } from './body';
import { outfit } from './items';

let nextId = 1;

export function getNextAgentId(): number {
  return nextId;
}

export function setNextAgentId(n: number) {
  nextId = n;
}

export const SKILLS = ['fighting', 'woodcutting', 'mining', 'farming', 'building', 'smithing', 'hauling', 'medicine', 'oratory', 'trading'] as const;

/** attribute roll, 1-5 centered on 3; the rare prodigy runs past the usual ceiling */
const rollAttr = () => ri(1, 3) + ri(0, 2);

function rollAttrs() {
  const attrs = {
    strength: rollAttr(), dexterity: rollAttr(), stamina: rollAttr(),
    charisma: rollAttr(), manipulation: rollAttr(), composure: rollAttr(),
    intelligence: rollAttr(), wits: rollAttr(), resolve: rollAttr(),
  };
  if (chance(0.05)) {
    const keys = Object.keys(attrs) as (keyof typeof attrs)[];
    attrs[pick(keys)] += 1; // can reach 6
  }
  return attrs;
}

export function makeAgent(factionId: number, x: number, y: number, role: Role, year: number, isFounder: boolean): Agent {
  const sex: 'm' | 'f' = chance(0.5) ? 'm' : 'f';
  const family = surname();
  const age = isFounder ? ri(17, 55) : ri(16, 20);
  const attrs = rollAttrs();
  const body = makeBody(attrs.stamina);
  const oldWoundNotes = weather(body, age);
  const skills: Record<string, number> = {};
  const skillXp: Record<string, number> = {};
  for (const s of SKILLS) { skills[s] = 0; skillXp[s] = 0; }
  // A few practiced skills from their past life.
  for (const s of shuffle([...SKILLS]).slice(0, ri(1, 3))) {
    skills[s] = Math.min(5, ri(1, Math.max(1, Math.floor(age / 12))));
  }

  const a: Agent = {
    id: nextId++,
    name: `${givenName(sex)} ${family}`,
    surname: family,
    sex,
    age,
    factionId,
    x, y,
    role,
    spouseId: null,
    motherId: null,
    fatherId: null,
    childIds: [],
    friendIds: [],
    rivalIds: [],
    grudgeIds: [],
    fledYear: -1,
    attrs,
    personality: shuffle([...PERSONALITY]).slice(0, ri(2, 3)),
    appearance: pick(APPEARANCE),
    belief: pick(BELIEFS),
    skills,
    skillXp,
    body,
    disease: null,
    immunity: 0,
    mutations: [],
    equipment: outfit(role),
    carrying: null,
    hunger: ri(0, 30),
    task: null,
    attackCooldown: 0,
    history: [],
    kills: 0,
    gathered: 0,
    built: 0,
    crafted: 0,
    alive: true,
    deathCause: null,
  };
  const birthYear = year - age;
  a.history.push({ year: birthYear, season: ri(0, 3), text: `Born.` });
  for (const note of oldWoundNotes) {
    a.history.push({ year: birthYear + ri(6, Math.max(7, age - 1)), season: ri(0, 3), text: `Since then, ${a.name} ${note}.` });
  }
  a.history.push({
    year, season: 0,
    text: isFounder ? `Was among the founders who raised the first hall.` : `Came of age and joined the settlement.`,
  });
  return a;
}

// no hard ceiling: two exceptional parents can pass on something rarer still
const inherit = (m: number, p: number) => Math.max(1, Math.round((m + p) / 2) + ri(-1, 1));

export function makeChild(mother: Agent, father: Agent, year: number, season: number, settlement: string): Agent {
  const attrs = { ...mother.attrs };
  for (const k of Object.keys(attrs) as (keyof Agent['attrs'])[]) {
    attrs[k] = inherit(mother.attrs[k], father.attrs[k]);
  }
  const skills: Record<string, number> = {};
  const skillXp: Record<string, number> = {};
  for (const s of SKILLS) { skills[s] = 0; skillXp[s] = 0; }
  const fromParent = chance(0.5) ? mother : father;
  const sex: 'm' | 'f' = chance(0.5) ? 'm' : 'f';

  const a: Agent = {
    id: nextId++,
    name: `${givenName(sex)} ${father.surname}`,
    surname: father.surname, // the father's house carries on
    sex,
    age: 0,
    factionId: mother.factionId,
    x: mother.x,
    y: mother.y,
    role: 'child',
    spouseId: null,
    motherId: mother.id,
    fatherId: father.id,
    childIds: [],
    friendIds: [],
    rivalIds: [],
    grudgeIds: [],
    fledYear: -1,
    attrs,
    personality: shuffle([...PERSONALITY]).slice(0, ri(2, 3)),
    appearance: chance(0.6)
      ? `${fromParent.appearance} — the very image of their ${fromParent.sex === 'f' ? 'mother' : 'father'}`
      : pick(APPEARANCE),
    belief: pick(BELIEFS),
    skills,
    skillXp,
    body: makeBody(attrs.stamina),
    disease: null,
    immunity: 0,
    mutations: [],
    equipment: [],
    carrying: null,
    hunger: ri(0, 20),
    task: null,
    attackCooldown: 0,
    history: [{ year, season, text: `Born in ${settlement}, child of ${mother.name} and ${father.name}.` }],
    kills: 0,
    gathered: 0,
    built: 0,
    crafted: 0,
    alive: true,
    deathCause: null,
  };
  mother.childIds.push(a.id);
  father.childIds.push(a.id);
  return a;
}

export function gainXp(a: Agent, skill: string, amount = 1) {
  a.skillXp[skill] = (a.skillXp[skill] ?? 0) + amount;
  // past 5 lies the territory of legends: progress slows to a crawl
  const need = (a.skills[skill] + 1) * 40 * (a.skills[skill] >= 5 ? 3 : 1);
  if (a.skillXp[skill] >= need) {
    a.skillXp[skill] = 0;
    a.skills[skill]++;
  }
}

export function skillLabel(level: number): string {
  if (level <= 0) return 'dabbling';
  if (level === 1) return 'novice';
  if (level === 2) return 'competent';
  if (level === 3) return 'skilled';
  if (level === 4) return 'expert';
  return 'legendary';
}
