import { pick, chance, ri, rand } from './rng';

// People carry classic biblical-Spanish names — a given name by sex plus a
// family surname that children inherit, so houses persist down the years.
const MALE_NAMES = [
  'José', 'Juan', 'Pedro', 'Pablo', 'Andrés', 'Santiago', 'Felipe', 'Tomás', 'Mateo', 'Marcos',
  'Lucas', 'Simón', 'Esteban', 'Miguel', 'Gabriel', 'Rafael', 'Daniel', 'David', 'Salomón', 'Moisés',
  'Aarón', 'Elías', 'Eliseo', 'Isaías', 'Jeremías', 'Ezequiel', 'Jonás', 'Samuel', 'Saúl', 'Rubén',
  'Benjamín', 'Isaac', 'Jacob', 'Abraham', 'Noé', 'Adán', 'Caleb', 'Josué', 'Gedeón', 'Ismael',
  'Lázaro', 'Zacarías', 'Matías', 'Bartolomé', 'Bernabé', 'Timoteo', 'Alberto', 'Alejandro', 'Alfonso', 'Álvaro',
  'Antonio', 'Bernardo', 'Carlos', 'Diego', 'Domingo', 'Emilio', 'Enrique', 'Fermín', 'Fernando', 'Francisco',
  'Gonzalo', 'Gregorio', 'Ignacio', 'Jaime', 'Javier', 'Joaquín', 'Jorge', 'Julián', 'Lorenzo', 'Luis',
  'Manuel', 'Martín', 'Nicolás', 'Pascual', 'Ramón', 'Rodrigo', 'Sancho', 'Sebastián', 'Teodoro', 'Vicente',
];
const FEMALE_NAMES = [
  'María', 'Ana', 'Isabel', 'Elena', 'Marta', 'Sara', 'Raquel', 'Rebeca', 'Ester', 'Judit',
  'Débora', 'Noemí', 'Rut', 'Salomé', 'Susana', 'Magdalena', 'Verónica', 'Juana', 'Josefa', 'Catalina',
  'Teresa', 'Lucía', 'Paula', 'Beatriz', 'Clara', 'Inés', 'Adela', 'Manuela', 'Dolores', 'Pilar',
  'Carmen', 'Rosa', 'Rosario', 'Mercedes', 'Amparo', 'Consuelo', 'Esperanza', 'Milagros', 'Soledad', 'Remedios',
  'Almudena', 'Aurora', 'Blanca', 'Cecilia', 'Constanza', 'Cristina', 'Emilia', 'Eugenia', 'Eulalia', 'Fabiola',
  'Francisca', 'Gracia', 'Guadalupe', 'Herminia', 'Jacinta', 'Leonor', 'Lourdes', 'Luisa', 'Margarita', 'Matilde',
  'Micaela', 'Petra', 'Ramona', 'Sofía', 'Tomasa', 'Úrsula', 'Valentina', 'Victoria', 'Ximena', 'Olalla',
];
const SURNAMES = [
  'Herrero', 'Herrera', 'Guerrero', 'Pastor', 'Molinero', 'Labrador', 'Tejedor', 'Cantero', 'Escudero', 'Cordero',
  'Serrano', 'Navarro', 'Moreno', 'Rubio', 'Blanco', 'Bravo', 'Delgado', 'Aguilar', 'Peña', 'Castillo',
  'Roca', 'Robles', 'Nieto', 'Crespo', 'Ibáñez', 'Velasco', 'Osorio', 'Quintana', 'Zamora', 'Salazar',
  'Toledo', 'Segura', 'Palacios', 'Carvajal', 'Mendoza', 'Vargas', 'Fuentes', 'Cabrera', 'Campos', 'Reyes',
  'Santos', 'Iglesias', 'Cruz', 'Paredes', 'Escobar', 'Rojas', 'Vega', 'Prado', 'Montes', 'Ríos',
  'del Río', 'del Valle', 'del Monte', 'de la Vega', 'de la Fuente', 'de la Cruz', 'del Prado', 'Salvador', 'Cárdenas', 'Espinosa',
  'Figueroa', 'Miranda', 'Ochoa', 'Valdés', 'Zúñiga',
];

export function givenName(sex: 'm' | 'f'): string {
  return pick(sex === 'm' ? MALE_NAMES : FEMALE_NAMES);
}

export function surname(): string {
  return pick(SURNAMES);
}

/** a full name for by-the-way people (item makers, myth figures) */
export function personName(sex?: 'm' | 'f'): string {
  const s = sex ?? (chance(0.5) ? 'm' : 'f');
  return `${givenName(s)} ${surname()}`;
}

// Faction names are generated in Spanish with real gender agreement;
// they are proper nouns, identical in both interface languages.
const FAC_NOUNS: [string, 'm' | 'f'][] = [
  ['Pacto', 'm'], ['Raíz', 'f'], ['Vena', 'f'], ['Estandarte', 'm'], ['Círculo', 'm'],
  ['Hogar', 'm'], ['Marea', 'f'], ['Corona', 'f'], ['Espina', 'f'], ['Coro', 'm'],
  ['Vínculo', 'm'], ['Yunque', 'm'], ['Farol', 'm'], ['Alianza', 'f'], ['Hermandad', 'f'],
];
const FAC_ADJS: [string, string][] = [
  ['Gris', 'Gris'], ['Silencioso', 'Silenciosa'], ['Profundo', 'Profunda'], ['Férreo', 'Férrea'],
  ['Ambarino', 'Ambarina'], ['Hueco', 'Hueca'], ['Carmesí', 'Carmesí'], ['Pálido', 'Pálida'],
  ['Quebrado', 'Quebrada'], ['Verde', 'Verde'], ['Sagrado', 'Sagrada'], ['Dorado', 'Dorada'],
  ['Salino', 'Salina'], ['Espinoso', 'Espinosa'], ['Ardiente', 'Ardiente'],
];
const FAC_OF = [
  'del Alba', 'del Roble', 'del Juramento', 'del Ocaso', 'de las Ascuas',
  'de la Sal', 'de la Piedra', 'de los Vientos', 'de las Sombras', 'de la Ceniza',
];

export function factionName(): string {
  const r = rand();
  const [noun, g] = pick(FAC_NOUNS);
  const art = g === 'm' ? 'El' : 'La';
  if (r < 0.45) {
    const adj = pick(FAC_ADJS);
    return `${art} ${noun} ${g === 'm' ? adj[0] : adj[1]}`;
  }
  if (r < 0.75) return `${art} ${noun} ${pick(FAC_OF)}`;
  return `Clan ${surname()}`;
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
    .replace('NAME', personName('m')) // patriarch-style founders keep “founder/fundador” agreeing in both languages
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

// Spanish-compound place names: Valdehierro, Peñalobos, Fuentefría…
const SETTLE_A = ['Valde', 'Villa', 'Fuente', 'Torre', 'Monte', 'Peña', 'Puente', 'Castro', 'Río', 'Campo', 'Cerro', 'Vista'];
const SETTLE_B = ['hierro', 'piedra', 'lobos', 'cuervos', 'sal', 'plata', 'ceniza', 'espinos', 'robles', 'olmos', 'brezos', 'halcones', 'fría', 'oscura'];

export function settlementName(): string {
  return pick(SETTLE_A) + pick(SETTLE_B);
}

export const QUARREL_REASONS = ['a gambling debt', 'a broken tool never repaid', 'an old insult at a feast', 'a matter of precedence', 'a shared sweetheart', 'the last word in an argument neither remembers starting'];

// Named works follow the old verb-noun pattern: Matalobos, Quiebrahuesos…
const ART_A = ['Muerde', 'Quiebra', 'Guarda', 'Corta', 'Rompe', 'Mata', 'Bebe', 'Canta', 'Llora', 'Busca'];
const ART_B = ['lobos', 'cenizas', 'penas', 'huesos', 'reyes', 'vientos', 'sombras', 'coronas', 'juramentos', 'estrellas'];

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
