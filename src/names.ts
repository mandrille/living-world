import { pick, chance, ri, rand } from './rng';

const SYL_A = ['Ur', 'Kel', 'Dor', 'Mar', 'Bel', 'Thra', 'Ing', 'Os', 'Vel', 'Gra', 'Hul', 'Ner', 'Ash', 'Bru', 'Kal', 'Ered', 'Som', 'Tal', 'Ulf', 'Wyn', 'Ral', 'Fen', 'Gor', 'Hild', 'Ist'];
const SYL_B = ['ath', 'im', 'or', 'ek', 'un', 'is', 'ar', 'oth', 'en', 'ik', 'ul', 'esh', 'an', 'il', 'us', 'em', 'od', 'ag'];
const SYL_C = ['a', 'i', 'o', 'u', 'e'];

export function personName(): string {
  let n = pick(SYL_A) + pick(SYL_B);
  if (chance(0.35)) n += pick(SYL_C) + pick(SYL_B);
  return n;
}

const FAC_ADJ = ['Ember', 'Grey', 'Deep', 'Silent', 'Iron', 'Amber', 'Hollow', 'Crimson', 'Pale', 'Sundered', 'Verdant', 'Oath', 'Salt', 'Thorn', 'Gilded'];
const FAC_NOUN = ['Pact', 'Root', 'Vein', 'Banner', 'Circle', 'Hearth', 'Tide', 'Crown', 'Spine', 'Ward', 'Choir', 'Reach', 'Bond', 'Anvil', 'Lantern'];

export function factionName(): string {
  const r = rand();
  const a = pick(FAC_ADJ), b = pick(FAC_NOUN);
  if (r < 0.4) return `The ${a} ${b}`;
  if (r < 0.7) return `${b} of the ${a} ${pick(FAC_NOUN)}`;
  return `Clan ${personName()}`;
}

export const ETHOS = [
  'venerate the deep ore and mistrust the open sky',
  'believe every debt must be repaid threefold',
  'hold that the forest remembers every axe-stroke',
  'prize oratory above the sword, and the sword above silence',
  'teach that the dead watch from the water',
  'consider hospitality sacred and betrayal unforgivable',
  'believe the world is a ledger kept by an indifferent clerk',
  'hold fire holy and let no hearth go cold',
];

export const GOVERNMENTS = ['council of elders', 'hereditary chiefdom', 'warrior meritocracy', 'priest-bureaucracy', 'loose confederation of households'];
export const LEADER_TITLES = ['High Matron', 'Warlord', 'First Speaker', 'Elder-of-Elders', 'Keeper of the Ledger', 'Hearthfather', 'Hearthmother'];

const MYTH_TPL = [
  'They say their founder NAME walked out of the SRC carrying nothing but a THING, and swore the oath that binds them still.',
  'Their songs claim they are the last remnant of a drowned kingdom, and that NAME will one day raise it again.',
  'A THING fell from the sky in the age of their grandmothers; they built their first hall where it landed.',
  'They were once slaves of a forgotten empire; NAME broke their chains with a THING and led them here.',
  'Their elders keep a THING no one may look upon, taken from the SRC by NAME at the price of an eye.',
];
const MYTH_SRC = ['burning mountains', 'endless marsh', 'white desert', 'sunless caverns', 'northern ice'];
const MYTH_THING = ['bronze bell', 'blackened crown', 'stone tablet', 'child’s shoe', 'broken sword', 'jar of ash'];

export function factionMyth(): string {
  return pick(MYTH_TPL)
    .replace('NAME', personName())
    .replace('SRC', pick(MYTH_SRC))
    .replace('THING', pick(MYTH_THING));
}

export const PERSONALITY = [
  'quick to anger', 'patient as stone', 'incorrigibly curious', 'superstitious', 'quietly ambitious',
  'generous to a fault', 'holds grudges', 'talks to animals', 'afraid of deep water', 'never forgets a face',
  'laughs at funerals', 'collects small stones', 'devout', 'a doubter', 'vain about their hair',
  'hums while working', 'sleeps poorly', 'fiercely loyal', 'a habitual liar about small things', 'dreams of the sea',
];

export const APPEARANCE = [
  'broad-shouldered, with a weathered face', 'wiry and sharp-eyed', 'short and thick-limbed',
  'tall, with ink-dark hair worn in braids', 'scar-cheeked and soft-spoken looking', 'round-faced and ruddy',
  'gaunt, with restless hands', 'heavy-browed, with a slow careful gait', 'freckled and sun-browned',
];

export const BELIEFS = [
  'keeps the old rites even when alone', 'believes their faction’s myth literally', 'privately doubts the elders',
  'thinks war is a debt collector', 'believes tools have souls', 'is certain they will die far from home',
  'believes names carry fate', 'thinks the leader is chosen by luck, not gods',
];

const SETTLE_A = ['Ember', 'Grey', 'Oak', 'Stone', 'Ash', 'Fen', 'Wolf', 'Bright', 'Cold', 'Iron', 'Moss', 'Raven', 'Salt', 'Thorn'];
const SETTLE_B = ['hold', 'fast', 'rest', 'gate', 'watch', 'hollow', 'mound', 'ford', 'stead', 'barrow', 'hearth'];

export function settlementName(): string {
  return pick(SETTLE_A) + pick(SETTLE_B);
}

export const QUARREL_REASONS = ['a gambling debt', 'a broken tool never repaid', 'an old insult at a feast', 'a matter of precedence', 'a shared sweetheart', 'the last word in an argument neither remembers starting'];

const ART_A = ['Ash', 'Oath', 'Grief', 'Winter', 'Ember', 'Vow', 'Marrow', 'Dusk', 'Sorrow', 'Thunder'];
const ART_B = ['biter', 'keeper', 'song', 'brand', 'ward', 'splitter', 'whisper', 'tithe', 'mark', 'fall'];

export function artifactName(): string {
  return pick(ART_A) + pick(ART_B);
}

const WAR_NOUNS = ['Salt Grudge', 'Broken Oath', 'Burned Bridge', 'Stolen Bride', 'Grey Winter', 'Unpaid Debt', 'Severed Hand', 'Poisoned Well', 'Two Crowns', 'Empty Granary'];

export function warName(): string {
  return `the War of the ${pick(WAR_NOUNS)}`;
}

export function seasonName(s: number): string {
  return ['Spring', 'Summer', 'Autumn', 'Winter'][s] ?? '?';
}
