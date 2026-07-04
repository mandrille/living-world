import { Item, ItemSlot, Role } from './types';
import { pick, chance, ri, rand, shuffle } from './rng';
import { personName, artifactName } from './names';

const MATERIALS = [
  { name: 'copper', mod: 0 }, { name: 'bronze', mod: 1 }, { name: 'iron', mod: 2 },
  { name: 'oak', mod: -1 }, { name: 'bone', mod: -1 }, { name: 'flint', mod: 0 },
];
const QUALITIES = [
  { name: 'crude', mod: -1, p: 0.3 }, { name: 'decent', mod: 0, p: 0.45 },
  { name: 'fine', mod: 1, p: 0.2 }, { name: 'masterwork', mod: 3, p: 0.05 },
];

const WEAPONS = [
  { kind: 'shortsword', base: 4 }, { kind: 'battleaxe', base: 5 }, { kind: 'spear', base: 4 },
  { kind: 'warclub', base: 3 }, { kind: 'long knife', base: 3 }, { kind: 'maul', base: 5 },
];
const TOOLS = [
  { kind: 'woodaxe', base: 2 }, { kind: 'pickaxe', base: 2 }, { kind: 'sickle', base: 1 }, { kind: 'mattock', base: 2 },
];
const APPAREL: { kind: string; slot: ItemSlot; base: number }[] = [
  { kind: 'leather cap', slot: 'head', base: 1 }, { kind: 'bronze helm', slot: 'head', base: 2 },
  { kind: 'padded tunic', slot: 'body', base: 1 }, { kind: 'leather cuirass', slot: 'body', base: 2 },
  { kind: 'mail shirt', slot: 'body', base: 3 }, { kind: 'wool wraps', slot: 'body', base: 1 },
  { kind: 'work gloves', slot: 'hands', base: 1 }, { kind: 'hide boots', slot: 'feet', base: 1 },
];
const TRINKETS = [
  'clay charm', 'braided cord', 'polished river stone', 'copper ring', 'carved fetish', 'tooth on a string', 'small bronze bell',
];
const STORIES = [
  'made by MAKER as an apprentice-piece',
  'traded from a wandering peddler for three days of bread',
  'taken from the hand of a fallen rival',
  'an heirloom, four generations old',
  'won in a wager MAKER still complains about',
  'made by MAKER during the hungry winter',
];

function quality(): { name: string; mod: number } {
  const r = rand();
  let acc = 0;
  for (const q of QUALITIES) {
    acc += q.p;
    if (r < acc) return q;
  }
  return QUALITIES[1];
}

function makeItem(kind: string, slot: ItemSlot, base: number, canBeArtifact = false): Item {
  const mat = pick(MATERIALS);
  const q = quality();
  const maker = personName();
  const isArtifact = canBeArtifact && q.name === 'masterwork' && chance(0.6);
  return {
    slot,
    kind,
    material: mat.name,
    quality: q.name,
    power: Math.max(1, base + mat.mod + q.mod),
    maker,
    artifactName: isArtifact ? artifactName() : null,
    name: `${q.name} ${mat.name} ${kind}`,
    story: pick(STORIES).replace('MAKER', maker),
  };
}

export function outfit(role: Role): Item[] {
  const items: Item[] = [];
  if (role === 'soldier' || role === 'leader') {
    const w = pick(WEAPONS);
    items.push(makeItem(w.kind, 'weapon', w.base, true));
    const armorCount = role === 'leader' ? 2 : ri(1, 2);
    const picks = shuffle([...APPAREL]).slice(0, armorCount + 1);
    const used = new Set<ItemSlot>();
    for (const a of picks) {
      if (used.has(a.slot)) continue;
      used.add(a.slot);
      items.push(makeItem(a.kind, a.slot, a.base));
    }
  } else {
    const t = pick(TOOLS);
    items.push(makeItem(t.kind, 'weapon', t.base));
    if (chance(0.5)) items.push(makeItem('padded tunic', 'body', 1));
    if (chance(0.3)) items.push(makeItem('hide boots', 'feet', 1));
  }
  if (chance(0.45)) items.push(makeItem(pick(TRINKETS), 'trinket', 0));
  return items;
}

/** An item deliberately forged by a named crafter at a workshop. Quality scales with skill. */
export function forgeItem(maker: string, settlement: string, smithSkill: number, material: 'wood' | 'metal'): Item {
  const isWeapon = chance(0.55);
  const apparel = pick(APPAREL);
  const def: { kind: string; base: number } = isWeapon ? pick(WEAPONS) : apparel;
  const slot: ItemSlot = isWeapon ? 'weapon' : apparel.slot;
  const mat = material === 'metal'
    ? pick(['bronze', 'iron', 'iron'])
    : isWeapon ? pick(['oak', 'bone']) : pick(['leather', 'hide', 'padded wool']);
  const matMod = mat === 'iron' ? 2 : mat === 'bronze' ? 1 : mat === 'leather' ? 0 : -1;

  const roll = rand() + smithSkill * 0.025;
  let q: { name: string; mod: number };
  if (roll > 1.12) q = { name: 'masterwork', mod: 3 };
  else if (roll > 0.75) q = { name: 'fine', mod: 1 };
  else if (roll > 0.35) q = { name: 'decent', mod: 0 };
  else q = { name: 'crude', mod: -1 };

  const isArtifact = q.name === 'masterwork';
  return {
    slot,
    kind: def.kind,
    material: mat,
    quality: q.name,
    power: Math.max(1, def.base + matMod + q.mod),
    maker,
    artifactName: isArtifact ? artifactName() : null,
    name: `${q.name} ${mat} ${def.kind}`,
    story: `forged by ${maker} in ${settlement}`,
  };
}

export function weaponPower(items: Item[]): number {
  const w = items.find((i) => i.slot === 'weapon');
  return w ? w.power : 1;
}

export function armorValue(items: Item[]): number {
  return items.filter((i) => i.slot !== 'weapon' && i.slot !== 'trinket').reduce((s, i) => s + i.power, 0);
}

export function itemLabel(i: Item): string {
  return i.artifactName ? `${i.name} “${i.artifactName}”` : i.name;
}
