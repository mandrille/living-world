import { BodyPart } from './types';
import { ri, pick, chance, rand } from './rng';

interface PartDef { name: string; hp: number; vital: boolean; internal: boolean; weight: number }

// weight = how likely this part is to be struck in combat
const BODY_PLAN: PartDef[] = [
  { name: 'head',       hp: 14, vital: true,  internal: false, weight: 8 },
  { name: 'brain',      hp: 8,  vital: true,  internal: true,  weight: 2 },
  { name: 'left eye',   hp: 4,  vital: false, internal: false, weight: 2 },
  { name: 'right eye',  hp: 4,  vital: false, internal: false, weight: 2 },
  { name: 'nose',       hp: 4,  vital: false, internal: false, weight: 2 },
  { name: 'mouth',      hp: 5,  vital: false, internal: false, weight: 2 },
  { name: 'neck',       hp: 10, vital: true,  internal: false, weight: 3 },
  { name: 'torso',      hp: 24, vital: true,  internal: false, weight: 16 },
  { name: 'heart',      hp: 8,  vital: true,  internal: true,  weight: 3 },
  { name: 'lungs',      hp: 10, vital: true,  internal: true,  weight: 4 },
  { name: 'guts',       hp: 12, vital: true,  internal: true,  weight: 5 },
  { name: 'left arm',   hp: 14, vital: false, internal: false, weight: 8 },
  { name: 'right arm',  hp: 14, vital: false, internal: false, weight: 8 },
  { name: 'left hand',  hp: 8,  vital: false, internal: false, weight: 4 },
  { name: 'right hand', hp: 8,  vital: false, internal: false, weight: 4 },
  { name: 'left leg',   hp: 16, vital: false, internal: false, weight: 8 },
  { name: 'right leg',  hp: 16, vital: false, internal: false, weight: 8 },
  { name: 'left foot',  hp: 9,  vital: false, internal: false, weight: 4 },
  { name: 'right foot', hp: 9,  vital: false, internal: false, weight: 4 },
];

const PART_WEIGHT_TOTAL = BODY_PLAN.reduce((s, p) => s + p.weight, 0);

/** stamina rated 1-5 adds up to +5 hp per part */
export function makeBody(stamina: number): BodyPart[] {
  return BODY_PLAN.map((p) => {
    const max = p.hp + stamina;
    return { name: p.name, hp: max, maxHp: max, vital: p.vital, internal: p.internal, missing: false, wounds: [] };
  });
}

/** Pick a random body part to strike, weighted by size. Skips missing parts. */
export function randomTarget(body: BodyPart[]): BodyPart {
  for (let tries = 0; tries < 12; tries++) {
    let r = Math.floor(rand() * PART_WEIGHT_TOTAL);
    for (let i = 0; i < BODY_PLAN.length; i++) {
      r -= BODY_PLAN[i].weight;
      if (r < 0) {
        const part = body[i];
        if (!part.missing) return part;
        break;
      }
    }
  }
  return body.find((p) => !p.missing) ?? body[7]; // torso fallback
}

const OLD_SCARS = [
  'an old burn scar', 'a badly-healed break', 'a pale slash scar', 'a childhood pox mark',
  'a wolf-bite scar', 'a brand from some old rite', 'frost-nipped skin',
];

/** Give a freshly-made adult some believable past damage. */
export function weather(body: BodyPart[], age: number): string[] {
  const notes: string[] = [];
  const oldWounds = Math.min(4, Math.floor((age - 16) / 10) + (chance(0.4) ? 1 : 0));
  for (let i = 0; i < oldWounds; i++) {
    const p = pick(body.filter((b) => !b.vital && !b.internal && !b.missing));
    if (!p) break;
    if (chance(0.08) && !p.name.includes('leg') && p.name !== 'torso') {
      p.missing = true;
      p.hp = 0;
      p.wounds.push('lost long ago');
      notes.push(`is missing their ${p.name}`);
    } else {
      const scar = pick(OLD_SCARS);
      p.wounds.push(scar);
      p.hp = Math.max(1, p.hp - ri(1, 3));
      notes.push(`carries ${scar} on the ${p.name}`);
    }
  }
  return notes;
}

export function bodySummary(body: BodyPart[]): { label: string; cls: string } {
  const missing = body.filter((p) => p.missing).length;
  const hurt = body.filter((p) => !p.missing && p.hp < p.maxHp * 0.6).length;
  if (missing > 0 && hurt > 1) return { label: 'maimed and wounded', cls: 'bad' };
  if (missing > 0) return { label: 'maimed but stable', cls: 'warn' };
  if (hurt > 2) return { label: 'badly wounded', cls: 'bad' };
  if (hurt > 0) return { label: 'wounded', cls: 'warn' };
  return { label: 'in good health', cls: 'good' };
}
