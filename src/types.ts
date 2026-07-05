export type TerrainType = 'grass' | 'forest' | 'mountain' | 'water' | 'ore' | 'farmland' | 'crater';
export type ResourceKind = 'food' | 'wood' | 'stone' | 'metal';

export interface Tile {
  terrain: TerrainType;
  /** harvestable amount left on this tile */
  amount: number;
  buildingId: number | null;
  /** foot-traffic wear; well-trodden grass renders as a path */
  wear?: number;
}

export type BuildingType = 'hall' | 'house' | 'farm' | 'barracks' | 'workshop' | 'hamlet';

export interface Building {
  id: number;
  type: BuildingType;
  factionId: number;
  x: number;
  y: number;
  progress: number;   // build progress 0..cost
  workNeeded: number;
  complete: boolean;
  builtYear: number; // year completed (0 while under construction)
  name: string;
}

export interface BodyPart {
  name: string;
  hp: number;
  maxHp: number;
  vital: boolean;
  internal: boolean;
  missing: boolean;
  wounds: string[]; // scars & permanent notes
}

export type ItemSlot = 'weapon' | 'head' | 'body' | 'hands' | 'feet' | 'trinket';

export interface Item {
  slot: ItemSlot;
  name: string;        // full display name, e.g. "fine iron battleaxe"
  kind: string;        // e.g. "battleaxe"
  material: string;
  quality: string;
  power: number;       // attack bonus (weapon) or armor value (apparel)
  maker: string;
  artifactName: string | null; // named items, e.g. "Ashbiter"
  story: string;       // one-line provenance
}

export type Role = 'worker' | 'builder' | 'soldier' | 'leader' | 'child' | 'crafter' | 'medic';

export interface Disease {
  name: string;
  days: number;
}

export interface Mutation {
  name: string;
  good: boolean;
  contagious: boolean;
  desc: string;
}

export type ResearchBranch = 'war' | 'trade' | 'science';

export interface Research {
  branch: ResearchBranch | null;
  progress: number;
  done: string[];
}

/** rated 1-5, grouped physical / social / mental */
export interface Attrs {
  strength: number;
  dexterity: number;
  stamina: number;
  charisma: number;
  manipulation: number;
  composure: number;
  intelligence: number;
  wits: number;
  resolve: number;
}

export interface LifeEvent {
  year: number;
  season: number;
  text: string;
}

export interface Task {
  kind: 'gather' | 'deposit' | 'build' | 'raid' | 'patrol' | 'eat' | 'wander' | 'flee' | 'craft' | 'trade' | 'heal';
  x: number;
  y: number;
  resource?: ResourceKind;
  buildingId?: number;
  progress?: number;
  targetFactionId?: number;
  patientId?: number;
}

export interface Agent {
  id: number;
  name: string;
  /** family name, inherited from the father — houses persist down the years */
  surname: string;
  sex: 'm' | 'f';
  age: number;
  factionId: number;
  x: number;
  y: number;
  role: Role;
  spouseId: number | null;
  motherId: number | null;
  fatherId: number | null;
  childIds: number[];
  friendIds: number[];
  rivalIds: number[];
  grudgeIds: number[]; // people they have sworn to kill
  fledYear: number; // last year they routed from battle (limits history spam)
  attrs: Attrs;
  personality: string[];
  appearance: string;
  belief: string;
  skills: Record<string, number>;
  skillXp: Record<string, number>;
  body: BodyPart[];
  disease: Disease | null;
  immunity: number; // days of protection after recovery
  mutations: Mutation[];
  equipment: Item[];
  carrying: { kind: ResourceKind; amount: number } | null;
  hunger: number; // 0..100
  task: Task | null;
  attackCooldown: number;
  history: LifeEvent[];
  kills: number;
  gathered: number;
  built: number;
  crafted: number;
  alive: boolean;
  deathCause: string | null;
}

export interface Beast {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface Corpse {
  x: number;
  y: number;
  agentId: number;
  year: number;
}

export interface WarState {
  a: number;
  b: number;
  name: string;
  startYear: number;
  lossesA: number;
  lossesB: number;
  weariness: number;
  seasonDeaths?: number; // fallen this season, for battle chronicle entries
  battleX?: number;
  battleY?: number;
}

export interface Faction {
  id: number;
  name: string;
  color: string;
  symbol: string;
  ethos: string;
  myth: string;
  government: string;
  settlement: string;
  leaderTitle: string;
  leaderId: number | null;
  hallX: number;
  hallY: number;
  stock: Record<ResourceKind, number>;
  relations: Record<number, number>; // -100..100 with other factions
  popHistory: number[]; // one entry per year
  scoreHistory: number[]; // one entry per year — the Judgment score over time
  research: Research;
  alive: boolean;
  warsWon: number;
  warsLost: number;
}

export interface ChronicleEntry {
  year: number;
  season: number;
  text: string;
  kind: 'war' | 'peace' | 'politics' | 'death' | 'building' | 'people' | 'misc' | 'disaster';
}
