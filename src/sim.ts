import {
  Agent, Beast, Building, BuildingType, ChronicleEntry, Corpse, Faction, Mutation, ResearchBranch, ResourceKind, Tile, WarState,
} from './types';
import { rand, ri, rf, pick, chance, shuffle, getRngState, setRngState } from './rng';
import { W, H, makeWorld, tileAt, inBounds, passable, findNearestTile, findFreeSpotNear } from './world';
import { makeAgent, makeChild, gainXp, getNextAgentId, setNextAgentId } from './agents';
import { makeFaction } from './factions';
import { randomTarget } from './body';
import { weaponPower, armorValue, itemLabel, outfit, forgeItem } from './items';
import { seasonName, settlementName, warName, QUARREL_REASONS } from './names';

export const TICKS_PER_DAY = 5;
export const DAYS_PER_SEASON = 20;
export const SEASONS_PER_YEAR = 4;

const FACTION_COUNT = 6;
const FOUNDERS_PER_FACTION = 45;
const HUNGER_RATE = 0.3;

interface BuildingPlan {
  type: BuildingType;
  cost: Partial<Record<ResourceKind, number>>;
  work: number;
}
const PLANS: Record<BuildingType, BuildingPlan> = {
  hall:     { type: 'hall',     cost: {},                    work: 0 },
  house:    { type: 'house',    cost: { wood: 20 },          work: 30 },
  farm:     { type: 'farm',     cost: { wood: 12 },          work: 25 },
  barracks: { type: 'barracks', cost: { wood: 25, stone: 12 }, work: 45 },
  workshop: { type: 'workshop', cost: { wood: 15, stone: 8 }, work: 35 },
  hamlet:   { type: 'hamlet',   cost: { wood: 30, stone: 10 }, work: 50 },
};

export class Sim {
  tiles: Tile[] = [];
  factions: Faction[] = [];
  agents: Agent[] = [];
  buildings: Building[] = [];
  wars: WarState[] = [];
  corpses: Corpse[] = [];
  beasts: Beast[] = [];
  chronicle: ChronicleEntry[] = [];

  tickCount = 0;
  year = 1;
  season = 0;
  day = 1;

  terrainDirty = true;
  selectedAgentId: number | null = null;
  selectedTile: { x: number; y: number } | null = null;
  private nextBuildingId = 1;
  private nextBeastId = 1;
  private grid = new Map<number, Agent[]>(); // coarse spatial buckets, rebuilt per tick
  private popCache: number[] = []; // living members per faction, refreshed per tick
  private agentMap = new Map<number, Agent>();

  constructor() {
    this.generate();
  }

  // ---------------- world generation ----------------

  private generate() {
    this.tiles = makeWorld();

    // Pick spread-out hall sites.
    const sites: { x: number; y: number }[] = [];
    for (let tries = 0; tries < 8000 && sites.length < FACTION_COUNT; tries++) {
      const x = ri(10, W - 11), y = ri(8, H - 9);
      if (tileAt(this.tiles, x, y).terrain !== 'grass') continue;
      if (sites.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 42)) continue;
      sites.push({ x, y });
    }
    while (sites.length < FACTION_COUNT) sites.push({ x: ri(10, W - 11), y: ri(8, H - 9) });

    for (let i = 0; i < FACTION_COUNT; i++) {
      const { x, y } = sites[i];
      const f = makeFaction(i, x, y);
      this.factions.push(f);
      this.addBuilding('hall', i, x, y, true);

      // starting farmland ring
      let farms = 0;
      for (let dy = -3; dy <= 3 && farms < 9; dy++) {
        for (let dx = -3; dx <= 3 && farms < 9; dx++) {
          if (!inBounds(x + dx, y + dy)) continue;
          const t = tileAt(this.tiles, x + dx, y + dy);
          if (t.terrain === 'grass' && t.buildingId === null && chance(0.5)) {
            t.terrain = 'farmland';
            t.amount = 12;
            farms++;
          }
        }
      }

      // founders
      for (let k = 0; k < FOUNDERS_PER_FACTION; k++) {
        const role = k === 0 ? 'leader' : k <= 9 ? 'soldier' : k <= 13 ? 'builder' : 'worker';
        const ax = Math.max(1, Math.min(W - 2, x + ri(-4, 4)));
        const ay = Math.max(1, Math.min(H - 2, y + ri(-4, 4)));
        const a = makeAgent(i, ax, ay, role, this.year, true);
        this.agents.push(this.register(a));
      }
      const members = this.membersOf(i);
      const presence = (m: Agent) => m.attrs.charisma * 2 + m.attrs.manipulation;
      const leader = members.reduce((b, a) => (presence(a) > presence(b) ? a : b), members[0]);
      leader.role = 'leader';
      f.leaderId = leader.id;
      leader.history.push({ year: this.year, season: 0, text: `Was acclaimed ${f.leaderTitle} of ${f.name}.` });

      // founders arrive with bonds already formed
      const singles = shuffle(members.filter((m) => m.age >= 18));
      for (let k = 0; k + 1 < singles.length && k < 16; k += 2) {
        if (!chance(0.55)) continue;
        this.marry(singles[k], singles[k + 1], true);
      }
      for (const m of members) {
        for (const o of shuffle([...members]).slice(0, ri(1, 2))) {
          if (o.id !== m.id && !m.friendIds.includes(o.id)) {
            m.friendIds.push(o.id);
            o.friendIds.push(m.id);
          }
        }
        if (chance(0.2)) {
          const r = pick(members);
          if (r.id !== m.id && !m.rivalIds.includes(r.id)) {
            m.rivalIds.push(r.id);
            r.rivalIds.push(m.id);
          }
        }
      }
    }

    // initial relations
    for (const a of this.factions) {
      for (const b of this.factions) {
        if (a.id >= b.id) continue;
        const v = ri(-40, 30);
        a.relations[b.id] = v;
        b.relations[a.id] = v;
      }
    }

    for (let p = 0; p < 5; p++) this.spawnPack();

    this.log('misc', `The world is young. ${FACTION_COUNT} peoples raise their first halls.`);
  }

  private spawnPack() {
    for (let tries = 0; tries < 200; tries++) {
      const x = ri(2, W - 3), y = ri(2, H - 3);
      if (tileAt(this.tiles, x, y).terrain !== 'forest') continue;
      if (this.factions.some((f) => f.alive && Math.abs(f.hallX - x) + Math.abs(f.hallY - y) < 16)) continue;
      const n = ri(3, 5);
      for (let k = 0; k < n; k++) {
        this.beasts.push({
          id: this.nextBeastId++,
          x: Math.max(1, Math.min(W - 2, x + ri(-2, 2))),
          y: Math.max(1, Math.min(H - 2, y + ri(-2, 2))),
          hp: 14,
          maxHp: 14,
        });
      }
      return;
    }
  }

  // ---------------- helpers ----------------

  agentById(id: number | null): Agent | undefined {
    if (id === null) return undefined;
    return this.agentMap.get(id) ?? this.agents.find((a) => a.id === id);
  }

  private register(a: Agent): Agent {
    this.agentMap.set(a.id, a);
    return a;
  }

  private marry(p: Agent, q: Agent, founding = false) {
    p.spouseId = q.id;
    q.spouseId = p.id;
    const suffix = founding ? ' in the old country, before the founding.' : `.`;
    this.hist(p, `Married ${q.name}${suffix}`);
    this.hist(q, `Married ${p.name}${suffix}`);
  }

  membersOf(factionId: number): Agent[] {
    return this.agents.filter((a) => a.alive && a.factionId === factionId);
  }

  factionPop(factionId: number): number {
    const cached = this.popCache[factionId];
    if (cached !== undefined) return cached;
    let n = 0;
    for (const a of this.agents) if (a.alive && a.factionId === factionId) n++;
    return n;
  }

  private factionPopExact(factionId: number): number {
    let n = 0;
    for (const a of this.agents) if (a.alive && a.factionId === factionId) n++;
    return n;
  }

  atWar(fa: number, fb: number): boolean {
    for (const w of this.wars) {
      if ((w.a === fa && w.b === fb) || (w.a === fb && w.b === fa)) return true;
    }
    return false;
  }

  private atWarAny(fa: number): boolean {
    for (const w of this.wars) {
      if (w.a === fa || w.b === fa) return true;
    }
    return false;
  }

  private shiftRelation(a: Faction, b: Faction, delta: number) {
    const v = Math.max(-100, Math.min(100, (a.relations[b.id] ?? 0) + delta));
    a.relations[b.id] = v;
    b.relations[a.id] = v;
  }

  log(kind: ChronicleEntry['kind'], text: string) {
    this.chronicle.unshift({ year: this.year, season: this.season, text, kind });
    if (this.chronicle.length > 300) this.chronicle.pop();
  }

  hist(a: Agent, text: string) {
    a.history.push({ year: this.year, season: this.season, text });
    if (a.history.length > 60) a.history.splice(1, 1); // keep birth entry, trim middle
  }

  private addBuilding(type: BuildingType, factionId: number, x: number, y: number, complete: boolean): Building {
    const f = this.factions[factionId];
    const plan = PLANS[type];
    const b: Building = {
      id: this.nextBuildingId++,
      type, factionId, x, y,
      progress: complete ? plan.work : 0,
      workNeeded: plan.work,
      complete,
      builtYear: complete ? this.year : 0,
      name: type === 'hall' ? `the Great Hall of ${f.settlement}`
        : type === 'hamlet' ? `the hamlet of ${settlementName()}`
        : `a ${type} in ${f.settlement}`,
    };
    this.buildings.push(b);
    tileAt(this.tiles, x, y).buildingId = b.id;
    this.terrainDirty = true;
    return b;
  }

  /** completed halls & hamlets per faction, rebuilt each tick with the grid */
  private hallCache: { x: number; y: number }[][] = [];

  private hallsOf(factionId: number): { x: number; y: number }[] {
    if (this.hallCache.length !== this.factions.length) this.rebuildHallCache();
    return this.hallCache[factionId] ?? [];
  }

  private rebuildHallCache() {
    this.hallCache = this.factions.map(() => []);
    for (const b of this.buildings) {
      if (b.complete && (b.type === 'hall' || b.type === 'hamlet')) {
        this.hallCache[b.factionId].push({ x: b.x, y: b.y });
      }
    }
  }

  /** the nearest completed hall or hamlet of the agent's own faction */
  private nearestOwnHall(a: Agent): { x: number; y: number } {
    const f = this.factions[a.factionId];
    let best = { x: f.hallX, y: f.hallY };
    let bd = Infinity;
    for (const b of this.hallsOf(a.factionId)) {
      const d = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  buildingAt(x: number, y: number): Building | null {
    if (!inBounds(x, y)) return null;
    const id = tileAt(this.tiles, x, y).buildingId;
    return id === null ? null : this.buildings.find((b) => b.id === id) ?? null;
  }

  // ---------------- main tick ----------------

  tick() {
    this.tickCount++;
    this.rebuildGrid();

    for (const a of this.agents) {
      if (a.alive) this.agentTick(a);
    }
    for (const b of this.beasts) this.beastTick(b);

    if (this.tickCount % TICKS_PER_DAY === 0) {
      this.day++;
      this.dayTick();
      if (this.day > DAYS_PER_SEASON) {
        this.day = 1;
        this.season++;
        if (this.season >= SEASONS_PER_YEAR) {
          this.season = 0;
          this.year++;
          this.yearTick();
        }
        this.seasonTick();
      }
    }
  }

  private rebuildGrid() {
    this.rebuildHallCache();
    this.grid.clear();
    this.popCache = new Array(this.factions.length).fill(0);
    for (const a of this.agents) {
      if (!a.alive) continue;
      this.popCache[a.factionId]++;
      const key = (a.y >> 2) * 64 + (a.x >> 2);
      let cell = this.grid.get(key);
      if (!cell) { cell = []; this.grid.set(key, cell); }
      cell.push(a);
    }
  }

  private nearbyAgents(x: number, y: number, range: number): Agent[] {
    const out: Agent[] = [];
    const c0x = (x - range) >> 2, c1x = (x + range) >> 2;
    const c0y = (y - range) >> 2, c1y = (y + range) >> 2;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const cell = this.grid.get(cy * 64 + cx);
        if (!cell) continue;
        for (const a of cell) {
          if (Math.abs(a.x - x) <= range && Math.abs(a.y - y) <= range) out.push(a);
        }
      }
    }
    return out;
  }

  private hostileNear(a: Agent, range: number): Agent | null {
    // hot path (every agent, every tick): walk the grid cells directly,
    // no intermediate array; bail out early when this faction has no wars
    if (!this.atWarAny(a.factionId)) return null;
    let best: Agent | null = null;
    let bestD = Infinity;
    const c0x = (a.x - range) >> 2, c1x = (a.x + range) >> 2;
    const c0y = (a.y - range) >> 2, c1y = (a.y + range) >> 2;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const cell = this.grid.get(cy * 64 + cx);
        if (!cell) continue;
        for (const o of cell) {
          if (o.factionId === a.factionId || !o.alive) continue;
          if (Math.abs(o.x - a.x) > range || Math.abs(o.y - a.y) > range) continue;
          if (!this.atWar(a.factionId, o.factionId)) continue;
          const d = Math.abs(o.x - a.x) + Math.abs(o.y - a.y);
          // a sworn enemy draws the eye before anyone else
          const score = a.grudgeIds.includes(o.id) ? d - 100 : d;
          if (score < bestD) { bestD = score; best = o; }
        }
      }
    }
    return best;
  }

  // ---------------- beasts ----------------

  private beastNear(a: Agent, range: number): Beast | null {
    for (const b of this.beasts) {
      if (Math.abs(b.x - a.x) <= range && Math.abs(b.y - a.y) <= range) return b;
    }
    return null;
  }

  private beastTick(b: Beast) {
    const nearby = this.nearbyAgents(b.x, b.y, 4);
    if (nearby.length > 0 && nearby.length <= 2) {
      // lone travelers are prey
      const t = nearby[0];
      if (Math.abs(t.x - b.x) <= 1 && Math.abs(t.y - b.y) <= 1) {
        if ((this.tickCount + b.id) % 5 === 0) this.wolfBite(t);
      } else {
        this.beastMove(b, t.x, t.y);
      }
      return;
    }
    if (nearby.length > 2) {
      // too many spears: slink away
      this.beastMove(b, b.x + Math.sign(b.x - nearby[0].x) * 3, b.y + Math.sign(b.y - nearby[0].y) * 3);
      return;
    }
    if (chance(0.35)) this.beastMove(b, b.x + ri(-3, 3), b.y + ri(-3, 3));
  }

  private beastMove(b: Beast, tx: number, ty: number) {
    const dx = Math.sign(tx - b.x);
    const dy = Math.sign(ty - b.y);
    if (passable(this.tiles, b.x + dx, b.y + dy)) { b.x += dx; b.y += dy; return; }
    if (passable(this.tiles, b.x + dx, b.y)) { b.x += dx; return; }
    if (passable(this.tiles, b.x, b.y + dy)) { b.y += dy; }
  }

  private wolfBite(a: Agent) {
    const part = randomTarget(a.body);
    const dmg = Math.max(1, Math.round(3 + rf(0, 3) - armorValue(a.equipment) / 3));
    part.hp -= dmg;
    if (part.hp <= 0) {
      if (part.vital) {
        this.kill(a, 'was torn apart by wolves on the road', null);
        return;
      }
      part.missing = true;
      part.hp = 0;
      part.wounds.push('taken by a wolf');
      this.hist(a, `A wolf took their ${part.name} on the road. They carried a spear ever after.`);
    } else if (dmg >= 4 && chance(0.5)) {
      part.wounds.push('a wolf bite');
      this.hist(a, `Was set upon by wolves in the wilds and bore the bite-marks after.`);
    }
  }

  // ---------------- agent behavior ----------------

  private agentTick(a: Agent) {
    if (a.attackCooldown > 0) a.attackCooldown--;
    a.hunger = Math.min(120, a.hunger + HUNGER_RATE);

    if (a.hunger >= 100 && this.tickCount % 10 === 0) {
      const guts = a.body.find((p) => p.name === 'guts');
      if (guts && !guts.missing) {
        guts.hp--;
        if (guts.hp <= 0) { this.kill(a, 'starved to death', null); return; }
      }
      if (!a.history.some((h) => h.year === this.year && h.text.includes('starving'))) {
        this.hist(a, 'Went starving through the lean days.');
      }
    }

    // slow mending when fed, not starving, and not sick (ember blood mends double)
    if ((this.tickCount + a.id) % 25 === 0 && a.hunger < 60 && !a.disease) {
      const p = a.body.find((pp) => !pp.missing && pp.hp < pp.maxHp);
      if (p) p.hp = Math.min(p.maxHp, p.hp + (a.mutations.some((m) => m.name === 'Ember Blood') ? 2 : 1));
    }

    // each agent gets one "daily" moment, staggered by id
    if ((this.tickCount + a.id) % TICKS_PER_DAY === 0) {
      if (a.immunity > 0) a.immunity--;
      if (a.disease) {
        this.diseaseTick(a);
        if (!a.alive) return;
      }
      for (const m of a.mutations) {
        if (m.contagious && chance(0.0004)) {
          for (const o of this.nearbyAgents(a.x, a.y, 1)) {
            if (o.id !== a.id && o.alive && !o.mutations.some((x) => x.name === m.name)) {
              this.mutate(o, `Caught the creeping change from ${a.name}.`, false, m);
              break;
            }
          }
        }
      }
      const tumor = a.body.find((p) => p.name === 'weeping tumor' && !p.missing);
      if (tumor && chance(0.03)) {
        tumor.maxHp++;
        if (tumor.maxHp > 14) {
          const organs = a.body.filter((p) => p.internal && !p.missing);
          if (organs.length) {
            const o = pick(organs);
            o.hp--;
            if (o.hp <= 0) { this.kill(a, 'was consumed by the weeping tumor', null); return; }
          }
        }
      }
    }

    // hostile at arm's length: fight — or break
    const foe = this.hostileNear(a, 1);
    if (foe) {
      if (a.task?.kind !== 'flee') {
        if (a.role === 'child' || this.shouldFlee(a)) {
          const h = this.nearestOwnHall(a);
          a.task = { kind: 'flee', x: h.x, y: h.y };
          if (a.fledYear !== this.year && a.role !== 'child') {
            a.fledYear = this.year;
            this.hist(a, 'Broke and fled the field, bleeding.');
          }
        } else if (a.attackCooldown === 0) {
          this.attack(a, foe);
        }
      }
      if (a.task?.kind === 'flee') this.doTask(a);
      return;
    }

    // wolves at hand: adults fight, children run
    const wolf = this.beastNear(a, 1);
    if (wolf) {
      if (a.role === 'child') {
        const h = this.nearestOwnHall(a);
        a.task = { kind: 'flee', x: h.x, y: h.y };
        this.doTask(a);
        return;
      }
      if (a.attackCooldown === 0) {
        a.attackCooldown = 5;
        gainXp(a, 'fighting', 1);
        wolf.hp -= Math.max(1, Math.round(a.attrs.strength + weaponPower(a.equipment) + rf(0, 2)));
        if (wolf.hp <= 0) {
          this.beasts = this.beasts.filter((w) => w !== wolf);
          this.hist(a, 'Slew a wolf that stalked the road.');
        }
      }
      return;
    }

    // hunger overrides work
    if (a.hunger > 70 && a.task?.kind !== 'eat') {
      const h = this.nearestOwnHall(a);
      a.task = { kind: 'eat', x: h.x, y: h.y };
    }

    if (!a.task) this.chooseTask(a);
    if (a.task) this.doTask(a);
  }

  private healthFrac(a: Agent): number {
    let hp = 0, max = 0;
    for (const p of a.body) {
      if (p.missing) continue;
      hp += p.hp;
      max += p.maxHp;
    }
    return max > 0 ? hp / max : 0;
  }

  private shouldFlee(a: Agent): boolean {
    return this.healthFrac(a) < 0.45 && rf(0, 1) > (a.attrs.composure + a.attrs.resolve) / 13;
  }

  private chooseTask(a: Agent) {
    const f = this.factions[a.factionId];
    const wars = this.wars.filter((w) => w.a === a.factionId || w.b === a.factionId);

    if (a.role === 'child') {
      const h = this.nearestOwnHall(a);
      a.task = { kind: 'wander', x: h.x + ri(-4, 4), y: h.y + ri(-4, 4) };
      return;
    }

    if (a.role === 'soldier' && wars.length > 0) {
      const enemyId = wars[0].a === a.factionId ? wars[0].b : wars[0].a;
      const ef = this.factions[enemyId];
      // march on the nearest enemy settlement, hamlets included
      const targets = this.buildings.filter(
        (b) => b.factionId === enemyId && b.complete && (b.type === 'hall' || b.type === 'hamlet')
      );
      const tgt = targets.sort(
        (p, q) => (Math.abs(p.x - a.x) + Math.abs(p.y - a.y)) - (Math.abs(q.x - a.x) + Math.abs(q.y - a.y))
      )[0] ?? { x: ef.hallX, y: ef.hallY };
      a.task = { kind: 'raid', x: tgt.x + ri(-2, 2), y: tgt.y + ri(-2, 2) };
      return;
    }
    if (a.role === 'soldier' || a.role === 'leader') {
      const r = a.role === 'leader' ? 3 : 8;
      const h = a.role === 'leader' ? { x: f.hallX, y: f.hallY } : this.nearestOwnHall(a);
      a.task = { kind: 'patrol', x: h.x + ri(-r, r), y: h.y + ri(-r, r) };
      if (a.role === 'leader' && chance(0.1)) gainXp(a, 'oratory', 3);
      return;
    }

    // medics: seek the sick and the broken
    if (a.role === 'medic') {
      let patient: Agent | null = null;
      let bd = Infinity;
      for (const m of this.membersOf(a.factionId)) {
        if (m.id === a.id) continue;
        if (m.disease === null && this.healthFrac(m) >= 0.6) continue;
        const dd = Math.abs(m.x - a.x) + Math.abs(m.y - a.y);
        if (dd < bd) { bd = dd; patient = m; }
      }
      if (patient) {
        a.task = { kind: 'heal', x: patient.x, y: patient.y, patientId: patient.id };
        return;
      }
      const h = this.nearestOwnHall(a);
      a.task = { kind: 'wander', x: h.x + ri(-5, 5), y: h.y + ri(-5, 5) };
      return;
    }

    // crafters: forge at the workshop when materials allow
    if (a.role === 'crafter') {
      const shop = this.buildings.find((b) => b.factionId === a.factionId && b.complete && b.type === 'workshop');
      if (shop && (f.stock.metal >= 3 || f.stock.wood >= 25)) {
        a.task = { kind: 'craft', x: shop.x, y: shop.y, buildingId: shop.id, progress: 0 };
        return;
      }
      // no materials: go gather some instead
    }

    // builders: find an unfinished building
    if (a.role === 'builder') {
      const site = this.buildings.find((b) => b.factionId === a.factionId && !b.complete);
      if (site) {
        a.task = { kind: 'build', x: site.x, y: site.y, buildingId: site.id };
        return;
      }
    }

    // workers (and idle builders): haul or gather
    if (a.carrying) {
      const h = this.nearestOwnHall(a);
      a.task = { kind: 'deposit', x: h.x, y: h.y };
      return;
    }
    const pop = this.factionPop(a.factionId);
    const targets: Record<ResourceKind, number> = {
      food: pop * 2, wood: 70, stone: 45, metal: 25,
    };
    const order = (Object.keys(targets) as ResourceKind[])
      .map((k) => ({ k, deficit: targets[k] - f.stock[k] }))
      .sort((x, y) => y.deficit - x.deficit);

    const terrainFor: Record<ResourceKind, string> = {
      food: 'farmland', wood: 'forest', stone: 'mountain', metal: 'ore',
    };
    for (const { k, deficit } of order) {
      if (deficit <= 0) break;
      const spot = findNearestTile(this.tiles, a.x, a.y, 50, (t) => t.terrain === terrainFor[k] && t.amount > 0);
      if (spot) {
        a.task = { kind: 'gather', x: spot.x, y: spot.y, resource: k, progress: 0 };
        return;
      }
    }
    a.task = { kind: 'wander', x: f.hallX + ri(-10, 10), y: f.hallY + ri(-10, 10) };
  }

  private doTask(a: Agent) {
    const t = a.task!;
    const arrived = a.x === t.x && a.y === t.y;
    const nearTarget = Math.abs(a.x - t.x) <= 1 && Math.abs(a.y - t.y) <= 1;

    switch (t.kind) {
      case 'flee': {
        if (arrived || !this.hostileNear(a, 6)) { a.task = null; break; }
        this.moveToward(a, t.x, t.y);
        break;
      }
      case 'wander':
      case 'patrol': {
        if (arrived || chance(0.02)) a.task = null;
        else this.moveToward(a, t.x, t.y);
        // workers near danger run home
        if (a.role === 'worker' && this.hostileNear(a, 3)) {
          const f = this.factions[a.factionId];
          a.task = { kind: 'wander', x: f.hallX, y: f.hallY };
        }
        break;
      }
      case 'raid': {
        // acquire live target near the objective
        const foe = this.hostileNear(a, 6);
        if (foe) { this.moveToward(a, foe.x, foe.y); break; }
        if (nearTarget) {
          // nobody left here; loiter, then re-evaluate
          if (chance(0.05)) a.task = null;
        } else this.moveToward(a, t.x, t.y);
        break;
      }
      case 'eat': {
        if (!nearTarget) { this.moveToward(a, t.x, t.y); break; }
        const f = this.factions[a.factionId];
        if (f.stock.food > 0) {
          f.stock.food--;
          a.hunger = 0;
          a.task = null;
        } else {
          // forage in desperation
          const spot = findNearestTile(this.tiles, a.x, a.y, 25, (tl) => tl.terrain === 'farmland' && tl.amount > 0);
          if (spot && a.x === spot.x && a.y === spot.y) {
            tileAt(this.tiles, spot.x, spot.y).amount--;
            a.hunger = Math.max(0, a.hunger - 60);
            a.task = null;
          } else if (spot) {
            this.moveToward(a, spot.x, spot.y);
          } else {
            a.task = null; // nothing to be done; keep working hungry
          }
        }
        break;
      }
      case 'gather': {
        if (!arrived) { this.moveToward(a, t.x, t.y); break; }
        const tile = tileAt(this.tiles, t.x, t.y);
        if (tile.amount <= 0) { a.task = null; break; }
        const skillName = t.resource === 'wood' ? 'woodcutting' : t.resource === 'food' ? 'farming' : 'mining';
        t.progress = (t.progress ?? 0) + 1;
        const need = Math.max(2, 6 - Math.floor(a.skills[skillName] / 2));
        if (t.progress >= need) {
          tile.amount--;
          if (tile.amount <= 0) {
            if (tile.terrain === 'forest') { tile.terrain = 'grass'; this.terrainDirty = true; }
            else if (tile.terrain === 'ore') { tile.terrain = 'mountain'; tile.amount = 40; this.terrainDirty = true; }
          }
          a.carrying = { kind: t.resource!, amount: 1 + Math.floor(a.skills[skillName] / 3) };
          a.gathered++;
          gainXp(a, skillName, 2);
          if (a.gathered === 30) this.hist(a, `Grew calloused and quick from steady work in the ${t.resource === 'wood' ? 'woods' : t.resource === 'food' ? 'fields' : 'diggings'}.`);
          if (a.gathered === 120) this.hist(a, `Became one of the settlement's most tireless providers.`);
          const h = this.nearestOwnHall(a);
          a.task = { kind: 'deposit', x: h.x, y: h.y };
        }
        break;
      }
      case 'deposit': {
        if (!nearTarget) { this.moveToward(a, t.x, t.y); break; }
        if (a.carrying) {
          this.factions[a.factionId].stock[a.carrying.kind] += a.carrying.amount;
          gainXp(a, 'hauling', 1);
          a.carrying = null;
        }
        a.task = null;
        break;
      }
      case 'heal': {
        const patient = this.agentById(t.patientId ?? null);
        if (!patient || !patient.alive || (!patient.disease && this.healthFrac(patient) >= 0.95)) {
          a.task = null;
          break;
        }
        t.x = patient.x;
        t.y = patient.y;
        const beside = Math.abs(a.x - patient.x) <= 1 && Math.abs(a.y - patient.y) <= 1;
        if (!beside) { this.moveToward(a, t.x, t.y); break; }
        gainXp(a, 'medicine', 1);
        // a practiced hand can cut the weeping tumor out
        const tumorMut = patient.mutations.find((m) => m.name === 'Weeping Tumor');
        if (tumorMut && a.skills['medicine'] >= 2 && chance(0.04 + a.skills['medicine'] * 0.02)) {
          patient.mutations = patient.mutations.filter((m) => m !== tumorMut);
          patient.body = patient.body.filter((p) => p.name !== 'weeping tumor');
          patient.attrs.stamina += 1;
          this.hist(patient, `Had the weeping tumor cut out by ${a.name}. The scar itches when it rains.`);
          this.hist(a, `Cut a weeping tumor from ${patient.name} and burned it. The whole hall watched.`);
          gainXp(a, 'medicine', 8);
          a.task = null;
          break;
        }
        if (patient.disease && chance(0.06 + a.skills['medicine'] * 0.03)) {
          const dname = patient.disease.name;
          patient.disease = null;
          this.hist(patient, `Was healed of ${dname} by ${a.name}'s care.`);
          this.hist(a, `Nursed ${patient.name} through ${dname} and won.`);
          gainXp(a, 'medicine', 6);
          a.task = null;
        } else if (!patient.disease && this.tickCount % 3 === 0) {
          const p = patient.body.find((pp) => !pp.missing && pp.hp < pp.maxHp);
          if (p) p.hp++;
        }
        break;
      }
      case 'craft': {
        const shop = this.buildings.find((bb) => bb.id === t.buildingId);
        const f = this.factions[a.factionId];
        if (!shop || !shop.complete) { a.task = null; break; }
        if (!nearTarget) { this.moveToward(a, t.x, t.y); break; }
        t.progress = (t.progress ?? 0) + 1 + Math.floor(a.skills['smithing'] / 4);
        if (t.progress < 60) break;

        // consume materials, preferring metal
        let material: 'wood' | 'metal';
        if (f.stock.metal >= 3) { f.stock.metal -= 3; material = 'metal'; }
        else if (f.stock.wood >= 5) { f.stock.wood -= 5; material = 'wood'; }
        else { a.task = null; break; }

        const item = forgeItem(a.name, f.settlement, a.skills['smithing'], material);
        gainXp(a, 'smithing', 5);
        a.crafted++;
        if (a.crafted === 1) this.hist(a, `Forged their first piece at the workshop of ${f.settlement}: ${itemLabel(item)}.`);
        if (a.crafted === 25) this.hist(a, `Has become the settlement's trusted smith; their mark is known on sight.`);
        if (item.quality === 'masterwork') {
          this.hist(a, `Forged ${itemLabel(item)} — the finest work of their life. The whole settlement came to see it.`);
          this.log('people', `${a.name} of ${f.name} has forged a masterwork: ${itemLabel(item)}.`);
        }

        // hand it to whoever needs it most
        const soldiers = this.membersOf(f.id).filter((m) => m.role === 'soldier' || m.role === 'leader');
        let given = false;
        if (item.slot === 'weapon') {
          const needy = soldiers.sort((x, y) => weaponPower(x.equipment) - weaponPower(y.equipment))[0];
          if (needy && weaponPower(needy.equipment) < item.power) {
            needy.equipment = needy.equipment.filter((i) => i.slot !== 'weapon');
            needy.equipment.push(item);
            this.hist(needy, `Was given ${itemLabel(item)}, ${item.story}.`);
            given = true;
          }
        } else {
          const needy = soldiers.filter((m) => !m.equipment.some((i) => i.slot === item.slot))[0]
            ?? soldiers.sort((x, y) => armorValue(x.equipment) - armorValue(y.equipment))[0];
          if (needy) {
            const old = needy.equipment.find((i) => i.slot === item.slot);
            if (!old || old.power < item.power) {
              needy.equipment = needy.equipment.filter((i) => i.slot !== item.slot);
              needy.equipment.push(item);
              this.hist(needy, `Was given ${itemLabel(item)}, ${item.story}.`);
              given = true;
            }
          }
        }
        if (!given && item.artifactName) {
          // a masterwork no one claims: the crafter keeps it
          a.equipment = a.equipment.filter((i) => i.slot !== item.slot);
          a.equipment.push(item);
        }
        a.task = null;
        break;
      }
      case 'trade': {
        if (!nearTarget) { this.moveToward(a, t.x, t.y); break; }
        const home = this.factions[a.factionId];
        const other = this.factions[t.targetFactionId!];
        if (!other.alive || this.atWar(home.id, other.id)) {
          // deal's off — haul the goods back home
          a.task = { kind: 'deposit', x: home.hallX, y: home.hallY };
          break;
        }
        if (a.carrying) {
          other.stock[a.carrying.kind] += a.carrying.amount;
          a.carrying = null;
        }
        // barter for whatever they have most of
        const theirKind = (Object.keys(other.stock) as ResourceKind[])
          .sort((x, y) => other.stock[y] - other.stock[x])[0];
        const give = Math.min(6 + this.techTier(home, 'trade') * 2, Math.floor(other.stock[theirKind] / 2));
        if (give > 0) {
          other.stock[theirKind] -= give;
          a.carrying = { kind: theirKind, amount: give };
        }
        this.shiftRelation(home, other, this.techTier(home, 'trade') >= 3 ? 8 : 5);
        this.hist(a, `Traded in ${other.settlement} and was feasted as a guest of ${other.name}.`);
        if (chance(0.3)) this.log('politics', `A caravan from ${home.name} arrives in ${other.settlement}; the roads grow friendly.`);
        gainXp(a, 'trading', 5);
        a.task = { kind: 'deposit', x: home.hallX, y: home.hallY };
        break;
      }
      case 'build': {
        const b = this.buildings.find((bb) => bb.id === t.buildingId);
        if (!b || b.complete) { a.task = null; break; }
        if (!nearTarget) { this.moveToward(a, t.x, t.y); break; }
        b.progress += 1 + Math.floor(a.skills['building'] / 3);
        gainXp(a, 'building', 2);
        if (b.progress >= b.workNeeded) {
          b.complete = true;
          if (b.builtYear === 0) b.builtYear = this.year; // repairs keep the original year
          a.built++;
          this.terrainDirty = true;
          this.hist(a, `Set the last beam of ${b.name} with their own hands.`);
          const f = this.factions[b.factionId];
          if (b.type === 'hamlet') {
            this.log('building', `${f.name} has founded ${b.name}. Smoke rises from a new hearth.`);
            this.plantFarm(b.x, b.y);
          } else {
            this.log('building', `${f.name} completed a ${b.type}.`);
          }
          if (b.type === 'farm') this.plantFarm(b.x, b.y);
          a.task = null;
        }
        break;
      }
    }
  }

  private plantFarm(x: number, y: number) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!inBounds(x + dx, y + dy)) continue;
        const t = tileAt(this.tiles, x + dx, y + dy);
        if (t.terrain === 'grass' && t.buildingId === null) {
          t.terrain = 'farmland';
          t.amount = 12;
        }
      }
    }
    this.terrainDirty = true;
  }

  private step(a: Agent, mx: number, my: number): boolean {
    if (mx === 0 && my === 0) return false;
    if (!passable(this.tiles, a.x + mx, a.y + my)) return false;
    a.x += mx;
    a.y += my;
    this.wearTile(a.x, a.y);
    this.radiationCheck(a);
    return true;
  }

  private moveToward(a: Agent, tx: number, ty: number) {
    // hot path (every moving agent, every tick): direct diagonal first,
    // then the two straight fallbacks in random order, allocation-free
    const dx = Math.sign(tx - a.x);
    const dy = Math.sign(ty - a.y);
    if (dx !== 0 && dy !== 0) {
      if (this.step(a, dx, dy)) return;
      if (chance(0.5)) {
        if (this.step(a, dx, 0) || this.step(a, 0, dy)) return;
      } else {
        if (this.step(a, 0, dy) || this.step(a, dx, 0)) return;
      }
    } else if (dx !== 0) {
      if (this.step(a, dx, 0)) return;
      if (this.step(a, dx, chance(0.5) ? 1 : -1)) return;
    } else if (dy !== 0) {
      if (this.step(a, 0, dy)) return;
      if (this.step(a, chance(0.5) ? 1 : -1, dy)) return;
    }
    // fully blocked: random legal step
    const rx = ri(-1, 1), ry = ri(-1, 1);
    if (passable(this.tiles, a.x + rx, a.y + ry)) { a.x += rx; a.y += ry; }
  }

  private wearTile(x: number, y: number) {
    const t = tileAt(this.tiles, x, y);
    if (t.terrain === 'grass') t.wear = (t.wear ?? 0) + 1;
  }

  /** glowing ground gets into the blood of whoever walks it */
  radiationCheck(a: Agent) {
    if (tileAt(this.tiles, a.x, a.y).terrain === 'crater' && chance(0.0006)) {
      this.mutate(a, 'The glowing ground crept into their blood.', true);
    }
  }

  // ---------------- combat ----------------

  private attack(atk: Agent, def: Agent) {
    atk.attackCooldown = 5;
    gainXp(atk, 'fighting', 1);
    const hitChance = Math.max(0.15, Math.min(0.95,
      0.55 + 0.04 * (atk.skills['fighting'] - def.skills['fighting']) + 0.02 * (atk.attrs.dexterity - def.attrs.dexterity)
    ));
    if (!chance(hitChance)) return;

    const part = randomTarget(def.body);
    const warBonus = this.techTier(this.factions[atk.factionId], 'war') * 0.8;
    const raw = atk.attrs.strength + weaponPower(atk.equipment) + warBonus + rf(0, 3);
    const dmg = Math.max(1, Math.round(raw - armorValue(def.equipment) / 2 - def.attrs.stamina / 3));
    part.hp -= dmg;
    gainXp(def, 'fighting', 1);

    const weapon = atk.equipment.find((i) => i.slot === 'weapon');
    const wname = weapon ? weapon.kind : 'bare hands';

    if (part.hp <= 0) {
      if (part.vital) {
        this.hist(atk, `Struck ${def.name} of ${this.factions[def.factionId].name} in the ${part.name} with a ${wname} — a killing blow.`);
        this.kill(def, `slain in battle by ${atk.name} of ${this.factions[atk.factionId].name} (the ${part.name} was destroyed)`, atk);
      } else {
        part.missing = true;
        part.hp = 0;
        part.wounds.push(`severed by ${atk.name}'s ${wname}`);
        this.hist(atk, `Severed the ${part.name} of ${def.name} in battle.`);
        this.hist(def, `Lost the ${part.name} to ${atk.name}'s ${wname}. The wound never lets them forget.`);
      }
    } else if (dmg >= 6) {
      part.wounds.push(`a deep ${wname} wound`);
      this.hist(def, `Took a deep wound to the ${part.name} from ${atk.name} of ${this.factions[atk.factionId].name}.`);
    }
  }

  private kill(a: Agent, cause: string, killer: Agent | null) {
    a.alive = false;
    a.deathCause = cause;
    a.task = null;
    const f = this.factions[a.factionId];

    this.corpses.push({ x: a.x, y: a.y, agentId: a.id, year: this.year });
    if (this.corpses.length > 400) this.corpses.shift();

    // grief and vengeance
    if (killer) {
      if (killer.grudgeIds.includes(a.id)) {
        killer.grudgeIds = killer.grudgeIds.filter((id) => id !== a.id);
        this.hist(killer, `Settled a blood-debt, striking down ${a.name} at last.`);
      }
      const kf = this.factions[killer.factionId];
      for (const m of this.agents) {
        if (!m.alive || m.id === a.id) continue;
        const isSpouse = m.spouseId === a.id;
        const isFriend = m.friendIds.includes(a.id);
        const isParent = m.childIds.includes(a.id);
        const isChild = m.motherId === a.id || m.fatherId === a.id;
        if (!isSpouse && !isFriend && !isParent && !isChild) continue;
        if (isSpouse) this.hist(m, `Was widowed: ${a.name}, their ${a.sex === 'm' ? 'husband' : 'wife'}, was slain by ${killer.name} of ${kf.name}.`);
        else if (isParent) this.hist(m, `Buried their ${a.sex === 'f' ? 'daughter' : 'son'} ${a.name}, slain by ${killer.name} of ${kf.name}. No parent should.`);
        else if (isChild) this.hist(m, `Lost their ${a.sex === 'm' ? 'father' : 'mother'} ${a.name} to ${killer.name} of ${kf.name}.`);
        else this.hist(m, `Mourned their friend ${a.name}, slain by ${killer.name} of ${kf.name}.`);
        if (m.role !== 'child' && !m.grudgeIds.includes(killer.id) && (isSpouse || isParent || chance(0.6))) {
          m.grudgeIds.push(killer.id);
          this.hist(m, `Swore a blood-oath against ${killer.name}.`);
        }
      }
    } else {
      for (const m of this.agents) {
        if (!m.alive || m.id === a.id) continue;
        if (m.spouseId === a.id) this.hist(m, `Buried ${a.name}. The hall is quieter now.`);
        else if (m.childIds.includes(a.id)) this.hist(m, `Outlived their ${a.sex === 'f' ? 'daughter' : 'son'} ${a.name}.`);
        else if (m.motherId === a.id || m.fatherId === a.id) this.hist(m, `Lost their ${a.sex === 'm' ? 'father' : 'mother'}, ${a.name}.`);
      }
    }

    if (killer) {
      killer.kills++;
      if (killer.kills === 1) this.hist(killer, 'Took a life for the first time. Slept badly for a season.');
      if (killer.kills === 5) this.hist(killer, 'Has become a name whispered by the enemy.');
      // loot a better weapon (artifacts especially)
      const vw = a.equipment.find((i) => i.slot === 'weapon');
      const kw = killer.equipment.find((i) => i.slot === 'weapon');
      if (vw && (!kw || vw.power > kw.power || vw.artifactName)) {
        killer.equipment = killer.equipment.filter((i) => i.slot !== 'weapon');
        killer.equipment.push(vw);
        this.hist(killer, `Took ${itemLabel(vw)} from the body of ${a.name}.`);
      }
      // count war losses
      for (const w of this.wars) {
        if (w.a === a.factionId && w.b === killer.factionId) w.lossesA++;
        else if (w.b === a.factionId && w.a === killer.factionId) w.lossesB++;
        else continue;
        w.seasonDeaths = (w.seasonDeaths ?? 0) + 1;
        w.battleX = a.x;
        w.battleY = a.y;
      }
    }

    const notable = a.id === f.leaderId || a.kills >= 3;
    if (notable || chance(0.15)) {
      this.log('death', `${a.name} of ${f.name} ${killer ? 'fell in battle' : cause}.`);
    }

    if (a.id === f.leaderId) {
      const members = this.membersOf(f.id).filter((m) => m.role !== 'child');
      if (members.length > 0) {
        const presence = (m: Agent) => m.attrs.charisma * 2 + m.attrs.manipulation;
        const ranked = [...members].sort((x, y) => presence(y) - presence(x));
        const heir = ranked[0];
        f.leaderId = heir.id;
        heir.role = 'leader';
        this.hist(heir, `Was raised to ${f.leaderTitle} of ${f.name} after the death of ${a.name}.`);
        this.log('politics', `${a.name}, ${f.leaderTitle} of ${f.name}, is dead. ${heir.name} now leads.`);

        // a close succession leaves a wound in the hall
        const passedOver = ranked[1];
        if (passedOver && presence(heir) - presence(passedOver) <= 2 && !heir.rivalIds.includes(passedOver.id)) {
          heir.rivalIds.push(passedOver.id);
          passedOver.rivalIds.push(heir.id);
          this.hist(passedOver, `Was passed over for the leadership of ${f.name} by a hair's breadth. The slight festers.`);
          this.hist(heir, `Took the leadership over the claim of ${passedOver.name}, who has not forgotten.`);
          this.log('politics', `The succession in ${f.settlement} is disputed; ${passedOver.name} seethes while ${heir.name} rules.`);
        }
      } else {
        f.leaderId = null;
      }
    }

    if (this.factionPopExact(f.id) === 0 && f.alive) {
      f.alive = false;
      this.log('war', `${f.name} is no more. Their halls stand silent.`);
      this.wars = this.wars.filter((w) => w.a !== f.id && w.b !== f.id);
    }
  }

  // ---------------- periodic ticks ----------------

  private dayTick() {
    // farmland regrows
    for (const t of this.tiles) {
      if (t.terrain === 'farmland' && t.amount < 12 && chance(0.35)) t.amount++;
    }
    // building planning
    for (const f of this.factions) {
      if (!f.alive) continue;
      this.planBuildings(f);
    }
  }

  private planBuildings(f: Faction) {
    const pending = this.buildings.filter((b) => b.factionId === f.id && !b.complete);
    if (pending.length >= 2) return;
    const done = (t: BuildingType) => this.buildings.filter((b) => b.factionId === f.id && b.complete && b.type === t).length;
    const pop = this.factionPop(f.id);
    const houses = done('house');
    const cap = 48 + houses * 8;

    let want: BuildingType | null = null;
    if (f.stock.food < pop && done('farm') < 4 + done('hamlet') * 2 && !pending.some((b) => b.type === 'farm')) want = 'farm';
    else if (houses < Math.ceil(pop / 9) && !pending.some((b) => b.type === 'house')) want = 'house';
    else if (pop > 22 && done('workshop') === 0 && !pending.some((b) => b.type === 'workshop')) want = 'workshop';
    else if (pop > 30 && done('barracks') === 0 && !pending.some((b) => b.type === 'barracks')) want = 'barracks';
    else if (pop > 60 && done('hamlet') < 2 && !pending.some((b) => b.type === 'hamlet')) want = 'hamlet';
    if (!want) return;

    const plan = PLANS[want];
    for (const [k, v] of Object.entries(plan.cost)) {
      if (f.stock[k as ResourceKind] < (v ?? 0)) return;
    }

    let spot: { x: number; y: number } | null = null;
    if (want === 'hamlet') {
      // strike out for open land, away from the capital and from rivals
      for (let tries = 0; tries < 14 && !spot; tries++) {
        const ang = rf(0, Math.PI * 2);
        const dist = ri(16, 26);
        const tx = Math.round(f.hallX + Math.cos(ang) * dist);
        const ty = Math.round(f.hallY + Math.sin(ang) * dist);
        if (!inBounds(tx, ty)) continue;
        if (this.factions.some((o) => o.id !== f.id && o.alive
          && Math.abs(o.hallX - tx) + Math.abs(o.hallY - ty) < 18)) continue;
        spot = findFreeSpotNear(this.tiles, tx, ty, 6);
      }
    } else {
      // grow around any of our settlements
      const anchors = this.buildings.filter(
        (b) => b.factionId === f.id && b.complete && (b.type === 'hall' || b.type === 'hamlet')
      );
      const anchor = anchors.length ? pick(anchors) : { x: f.hallX, y: f.hallY };
      spot = findFreeSpotNear(this.tiles, anchor.x + ri(-6, 6), anchor.y + ri(-6, 6), 8);
    }
    if (!spot) return;

    for (const [k, v] of Object.entries(plan.cost)) {
      f.stock[k as ResourceKind] -= v ?? 0;
    }
    const b = this.addBuilding(want, f.id, spot.x, spot.y, false);
    if (want === 'hamlet') {
      this.log('building', `${f.name} breaks ground for ${b.name}, a day's walk from ${f.settlement}.`);
    }
  }

  private seasonTick() {
    if (this.beasts.length < 12 && chance(0.5)) this.spawnPack();
    this.maybeNuke(); // the bomb speaks before the diplomats
    this.politics();
    this.research();
    this.plagues();
    this.disasters();
    this.festivals();
    this.socialLife();
    this.tradeCaravans();
    this.rebalanceRoles();
    this.growPopulation();
    this.terrainDirty = true; // worn paths appear
  }

  // ---------------- research ----------------

  static TECH_TREE: Record<ResearchBranch, { name: string; cost: number; flavor: string }[]> = {
    war: [
      { name: 'Bronzeworking', cost: 80, flavor: 'Their forges ring day and night.' },
      { name: 'Ironworking', cost: 160, flavor: 'Black iron takes an edge that does not forgive.' },
      { name: 'Gunpowder', cost: 300, flavor: 'Thunder is theirs to command now.' },
      { name: 'Industry', cost: 450, flavor: 'Chimneys rise where trees once stood.' },
      { name: 'Atomics', cost: 650, flavor: 'In a deep cellar, a terrible sun is born.' },
    ],
    trade: [
      { name: 'Coinage', cost: 80, flavor: 'Stamped bronze passes from hand to hand.' },
      { name: 'Contracts', cost: 160, flavor: 'A promise written outlives the one who spoke it.' },
      { name: 'Banking', cost: 300, flavor: 'Wealth breeds in locked cellars.' },
      { name: 'Markets', cost: 450, flavor: 'Everything has a price, and they know it.' },
      { name: 'the Grand Exchange', cost: 650, flavor: 'Caravans queue at their gates from dawn to dusk.' },
    ],
    science: [
      { name: 'Letters', cost: 80, flavor: 'What is written cannot be unremembered.' },
      { name: 'Astronomy', cost: 160, flavor: 'They chart the wandering stars and name them.' },
      { name: 'Engineering', cost: 300, flavor: 'Water climbs hills at their command.' },
      { name: 'Rocketry', cost: 450, flavor: 'A silver needle screams into the clouds.' },
      { name: 'Spaceflight', cost: 650, flavor: 'They have hurled their own beyond the sky. The heavens hold their breath.' },
    ],
  };

  hasTech(f: Faction, name: string): boolean {
    return f.research.done.includes(name);
  }

  techTier(f: Faction, branch: ResearchBranch): number {
    return Sim.TECH_TREE[branch].filter((t) => f.research.done.includes(t.name)).length;
  }

  private research() {
    for (const f of this.factions) {
      if (!f.alive) continue;
      const r = f.research;
      if (r.branch === null || Sim.TECH_TREE[r.branch].every((t) => r.done.includes(t.name))) {
        // pick (or re-pick) the direction of inquiry
        const open = (['war', 'trade', 'science'] as ResearchBranch[])
          .filter((b) => Sim.TECH_TREE[b].some((t) => !r.done.includes(t.name)));
        if (open.length === 0) continue;
        r.branch = pick(open);
      }
      const pop = this.factionPop(f.id);
      const workshops = this.buildings.filter((b) => b.factionId === f.id && b.complete && b.type === 'workshop').length;
      const leader = this.agentById(f.leaderId);
      r.progress += 1 + workshops + Math.floor(pop / 40)
        + (leader ? Math.floor(leader.attrs.intelligence / 2) : 0)
        + this.techTier(f, 'science');

      const next = Sim.TECH_TREE[r.branch].find((t) => !r.done.includes(t.name));
      if (next && r.progress >= next.cost) {
        r.progress = 0;
        r.done.push(next.name);
        this.log('misc', `⚗ ${f.name} masters ${next.name}. ${next.flavor}`);
        if (leader) this.hist(leader, `Under their rule, ${f.settlement} mastered ${next.name}.`);
      }
    }
  }

  private maybeNuke() {
    for (const w of [...this.wars]) {
      const sides: [number, number, number][] = [[w.a, w.b, w.lossesA], [w.b, w.a, w.lossesB]];
      for (const [selfId, foeId, selfLosses] of sides) {
        const f = this.factions[selfId];
        const foe = this.factions[foeId];
        if (!f.alive || !foe.alive || !this.hasTech(f, 'Atomics')) continue;
        // desperation — or the cold arithmetic of ending a war that drags
        const desperate = selfLosses >= 10;
        const impatient = w.weariness >= 5 || w.lossesA + w.lossesB >= 15;
        if ((!desperate && !impatient) || !chance(0.25)) continue;
        this.dropSunfire(f, foe, w);
        return; // one sunrise per season is plenty
      }
    }
  }

  private dropSunfire(f: Faction, target: Faction, w: WarState) {
    const halls = this.buildings.filter((b) => b.factionId === target.id && b.complete && (b.type === 'hall' || b.type === 'hamlet'));
    const gz = halls.length ? pick(halls) : { x: target.hallX, y: target.hallY };
    const R = 6;
    const siteName = this.nearestSettlementName(gz.x, gz.y);

    for (let y = gz.y - R; y <= gz.y + R; y++) {
      for (let x = gz.x - R; x <= gz.x + R; x++) {
        if (!inBounds(x, y)) continue;
        if (Math.abs(x - gz.x) + Math.abs(y - gz.y) > R + ri(0, 2)) continue;
        const t = tileAt(this.tiles, x, y);
        if (t.terrain !== 'water') {
          t.terrain = 'crater';
          t.amount = 0;
          t.wear = 0;
        }
      }
    }
    this.buildings = this.buildings.filter((b) => {
      if (Math.abs(b.x - gz.x) + Math.abs(b.y - gz.y) <= R) {
        const t = tileAt(this.tiles, b.x, b.y);
        if (t.buildingId === b.id) t.buildingId = null;
        return false;
      }
      return true;
    });

    let dead = 0;
    for (const a of this.agents) {
      if (!a.alive) continue;
      const d = Math.max(Math.abs(a.x - gz.x), Math.abs(a.y - gz.y));
      if (d <= R) {
        if (chance(0.75)) {
          this.kill(a, `vanished in the sunfire that fell on ${siteName}`, null);
          dead++;
        } else {
          this.hist(a, `Stood inside the sunfire of ${siteName} and, impossibly, walked out.`);
          this.mutate(a, 'The sunfire seared the very seed of them.', true);
        }
      } else if (d <= R + 4 && chance(0.5)) {
        this.hist(a, `Watched the second sun rise over ${siteName}. Their skin peeled for a month.`);
        if (chance(0.6)) this.mutate(a, 'The glow of the sunfire crept into their blood.', true);
      }
    }

    for (const o of this.factions) {
      if (o.id !== f.id && o.alive) this.shiftRelation(f, o, -40);
    }
    w.weariness += 6;
    this.terrainDirty = true;
    this.log('disaster', `☢ ${f.name} unleashes the sunfire upon ${siteName}: ${dead} souls gone in a breath. A glass crater glows where streets were. The world will not forgive this.`);
  }

  private nearestSettlementName(x: number, y: number): string {
    let best = 'the wilds';
    let bd = Infinity;
    for (const b of this.buildings) {
      if (b.type !== 'hall' && b.type !== 'hamlet') continue;
      const d = Math.abs(b.x - x) + Math.abs(b.y - y);
      if (d < bd) {
        bd = d;
        best = b.type === 'hall' ? this.factions[b.factionId].settlement : b.name.replace('the hamlet of ', '');
      }
    }
    return best;
  }

  private disasters() {
    // wildfire, in the dry seasons
    if (this.season !== 3 && chance(0.035)) {
      const spot = findNearestTile(this.tiles, ri(10, W - 11), ri(8, H - 9), 30, (t) => t.terrain === 'forest');
      if (spot) {
        const r = ri(3, 6);
        for (let y = spot.y - r; y <= spot.y + r; y++) {
          for (let x = spot.x - r; x <= spot.x + r; x++) {
            if (!inBounds(x, y)) continue;
            if (Math.abs(x - spot.x) + Math.abs(y - spot.y) > r + ri(0, 2)) continue;
            const t = tileAt(this.tiles, x, y);
            if (t.terrain === 'forest' || t.terrain === 'grass' || t.terrain === 'farmland') {
              t.terrain = 'grass';
              t.amount = 0;
              t.wear = 0;
            }
          }
        }
        for (const a of this.nearbyAgents(spot.x, spot.y, r)) {
          if (!a.alive) continue;
          const limbs = a.body.filter((pp) => !pp.missing && !pp.internal);
          if (limbs.length === 0) continue;
          const p = pick(limbs);
          p.hp -= ri(2, 6);
          p.wounds.push(`burn scars from the great fire of Y${this.year}`);
          if (p.hp <= 0) {
            if (p.vital) { this.kill(a, `burned to death in the great fire of Y${this.year}`, null); continue; }
            p.missing = true;
            p.hp = 0;
          }
          this.hist(a, `Ran through the flames of the great fire of Y${this.year}.`);
          if (chance(0.05)) this.mutate(a, 'The fire left more than scars.');
        }
        this.terrainDirty = true;
        this.log('disaster', `🔥 A great fire sweeps the woods near ${this.nearestSettlementName(spot.x, spot.y)}. The sky goes brown for days.`);
      }
    }

    // earthquake
    if (chance(0.018)) {
      const ex = ri(10, W - 11), ey = ri(8, H - 9);
      let wrecked = 0;
      for (const b of this.buildings) {
        if (Math.abs(b.x - ex) + Math.abs(b.y - ey) > 14) continue;
        if (b.complete && b.workNeeded > 0 && chance(0.4)) {
          b.complete = false;
          b.progress = Math.floor(b.workNeeded * 0.4);
          wrecked++;
        }
      }
      for (const a of this.nearbyAgents(ex, ey, 14)) {
        if (!a.alive || !chance(0.15)) continue;
        const legs = a.body.filter((p) => (p.name.includes('leg') || p.name.includes('foot')) && !p.missing);
        if (legs.length === 0) continue;
        const p = pick(legs);
        p.hp -= ri(2, 5);
        if (p.hp <= 0) { p.hp = 1; }
        p.wounds.push('crushed in the quake');
        this.hist(a, `Was caught in the quake of Y${this.year}; the ${p.name} never sat right again.`);
      }
      if (wrecked > 0) {
        this.terrainDirty = true;
        this.log('disaster', `⌁ The earth shakes near ${this.nearestSettlementName(ex, ey)}: ${wrecked} building(s) brought down. The rebuilding begins at dawn.`);
      }
    }

    // spring flood
    if (this.season === 0 && chance(0.04)) {
      let drownedFields = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = this.tiles[y * W + x];
          if (t.terrain !== 'farmland' || t.amount === 0) continue;
          let nearWater = false;
          for (let dy = -2; dy <= 2 && !nearWater; dy++) {
            for (let dx = -2; dx <= 2 && !nearWater; dx++) {
              if (inBounds(x + dx, y + dy) && tileAt(this.tiles, x + dx, y + dy).terrain === 'water') nearWater = true;
            }
          }
          if (nearWater && chance(0.6)) {
            t.amount = 0;
            drownedFields++;
          }
        }
      }
      if (drownedFields > 4) {
        this.log('disaster', `≈ The rivers rise with the thaw; ${drownedFields} fields drown in the lowlands. A hungry summer follows.`);
      }
    }
  }

  private festivals() {
    const FEASTS = ['the Sowing Feast', 'the Midsummer Fire', 'the Harvest Home', 'the Long Night Vigil'];
    const feast = FEASTS[this.season];
    for (const f of this.factions) {
      if (!f.alive || !chance(0.3)) continue;
      const members = this.membersOf(f.id);
      if (members.length < 10 || this.wars.some((w) => w.a === f.id || w.b === f.id)) continue;
      for (const m of members) {
        if (!chance(0.08)) continue;
        this.hist(m, pick([
          `Danced at ${feast} until dawn.`,
          `Won the wrestling at ${feast}.`,
          `Drank too deep at ${feast} and swore off drink (again).`,
          `Sang the old songs at ${feast}; some wept.`,
        ]));
      }
      if (chance(0.15)) this.log('people', `${f.settlement} keeps ${feast}. The fires burn late.`);
    }
  }

  private plagues() {
    const DISEASES = ['the grey fever', 'the coughing blight', 'the weeping pox', 'the winter sweats', 'the marsh chills'];
    for (const f of this.factions) {
      if (!f.alive) continue;
      const members = this.membersOf(f.id);

      // a full outbreak in a crowded settlement
      if (members.length >= 60 && chance(0.02)) {
        const sickness = pick(DISEASES);
        let struck = 0;
        for (const m of members) {
          if (!m.disease && m.immunity <= 0 && chance(0.2)) {
            m.disease = { name: sickness, days: 0 };
            struck++;
          }
        }
        if (struck > 3) {
          this.log('death', `☠ ${sickness[0].toUpperCase() + sickness.slice(1)} breaks out in ${f.settlement}: ${struck} lie sick in ${f.name}.`);
        }
      } else if (members.length > 0 && chance(0.03)) {
        // or a single traveler brings something home
        const m = pick(members);
        if (!m.disease && m.immunity <= 0) m.disease = { name: pick(DISEASES), days: 0 };
      }
    }
  }

  // ---------------- mutations ----------------

  private static MUTATIONS: Mutation[] = [
    { name: 'Third Eye', good: true, contagious: false, desc: 'a lidless third eye that sees what others cannot (+2 resolve, +1 wits)' },
    { name: 'Ember Blood', good: true, contagious: false, desc: 'blood that runs hot and mends flesh at twice the pace' },
    { name: 'Iron Hide', good: true, contagious: false, desc: 'skin like boiled leather (+2 stamina)' },
    { name: 'Silver Tongue', good: true, contagious: false, desc: 'a voice that bends whole rooms (+2 charisma)' },
    { name: 'Long Stride', good: true, contagious: false, desc: 'sinews like drawn wire (+2 dexterity)' },
    { name: 'Weeping Tumor', good: false, contagious: true, desc: 'a growth that weeps, aches, and passes to those who tend them (-1 stamina)' },
    { name: 'Glass Bones', good: false, contagious: false, desc: 'bones that crack under common burdens (-2 stamina, -1 strength)' },
    { name: 'Night Terrors', good: false, contagious: false, desc: 'dreams that leave them screaming at the rafters (-2 composure)' },
    { name: 'Withered Arm', good: false, contagious: false, desc: 'an arm gone thin and weak (-1 strength)' },
  ];

  mutate(a: Agent, reason: string, mostlyBad = false, forced?: Mutation) {
    let mut = forced;
    if (!mut) {
      const owned = new Set(a.mutations.map((m) => m.name));
      const pool = Sim.MUTATIONS.filter((m) => !owned.has(m.name));
      if (pool.length === 0) return;
      const goods = pool.filter((m) => m.good);
      const bads = pool.filter((m) => !m.good);
      const wantGood = chance(mostlyBad ? 0.15 : 0.4);
      const from = wantGood && goods.length ? goods : bads.length ? bads : goods;
      mut = pick(from);
    } else if (a.mutations.some((m) => m.name === mut!.name)) {
      return;
    }

    a.mutations.push(mut);
    const AT = a.attrs;
    const floor1 = (v: number) => Math.max(1, v);
    switch (mut.name) {
      case 'Third Eye':
        AT.resolve += 2; AT.wits += 1;
        a.body.push({ name: 'third eye', hp: 4, maxHp: 4, vital: false, internal: false, missing: false, wounds: [] });
        break;
      case 'Iron Hide': AT.stamina += 2; break;
      case 'Silver Tongue': AT.charisma += 2; break;
      case 'Long Stride': AT.dexterity += 2; break;
      case 'Weeping Tumor':
        AT.stamina = floor1(AT.stamina - 1);
        a.body.push({ name: 'weeping tumor', hp: 6, maxHp: 6, vital: false, internal: false, missing: false, wounds: ['it grows, slowly'] });
        break;
      case 'Glass Bones': AT.stamina = floor1(AT.stamina - 2); AT.strength = floor1(AT.strength - 1); break;
      case 'Night Terrors': AT.composure = floor1(AT.composure - 2); break;
      case 'Withered Arm': {
        AT.strength = floor1(AT.strength - 1);
        const arm = a.body.find((p) => p.name.includes('arm') && !p.missing);
        if (arm) arm.wounds.push('withered by the change');
        break;
      }
    }
    this.hist(a, `${reason} They now bear ${mut.name}: ${mut.desc}.`);
    if (chance(0.35)) {
      const f = this.factions[a.factionId];
      this.log('people', mut.good
        ? `${a.name} of ${f.name} has changed: ${mut.desc}. Some call it a blessing.`
        : `${a.name} of ${f.name} is marked by ${mut.name}. Neighbors make signs against it.`);
    }
  }

  private static DISEASE_ORGAN: Record<string, string> = {
    'the grey fever': 'brain',
    'the coughing blight': 'lungs',
    'the weeping pox': 'guts',
    'the winter sweats': 'heart',
    'the marsh chills': 'lungs',
  };

  /** one moment per day, per agent: sickness runs its course and spreads */
  private diseaseTick(a: Agent) {
    const d = a.disease!;
    d.days++;
    const frail = a.age < 8 || a.age > 55;

    // each sickness gnaws at its own organ; the young and old fare worst
    if (d.days % 2 === 0) {
      const target = Sim.DISEASE_ORGAN[d.name] ?? 'guts';
      const p = a.body.find((x) => x.name === target && !x.missing)
        ?? pick(a.body.filter((x) => x.internal && !x.missing));
      if (p) {
        p.hp -= frail ? 2 : 1;
        if (p.hp <= 0) {
          this.kill(a, `died of ${d.name} after ${d.days} days`, null);
          return;
        }
      }
    }

    // the strong shake it off; and every fever breaks eventually
    if (d.days >= 20 || chance((0.05 + a.attrs.stamina * 0.02) * (frail ? 0.5 : 1))) {
      this.hist(a, `Shook off ${d.name} after ${d.days} days abed.`);
      a.disease = null;
      a.immunity = 90; // hard-won protection, for a time
      if (chance(0.008)) this.mutate(a, `Something in ${d.name} changed them.`);
      return;
    }

    // and it leaps to whoever stands too close
    if (chance(0.12)) {
      for (const o of this.nearbyAgents(a.x, a.y, 1)) {
        if (o.id !== a.id && o.alive && !o.disease && o.immunity <= 0 && chance(0.5)) {
          o.disease = { name: d.name, days: 0 };
          break;
        }
      }
    }
  }

  private tradeCaravans() {
    const live = this.factions.filter((f) => f.alive);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if ((a.relations[b.id] ?? 0) < 40 || this.atWar(a.id, b.id) || !chance(0.4)) continue;
        const total = (f: Faction) => f.stock.food + f.stock.wood + f.stock.stone + f.stock.metal;
        const sender = total(a) >= total(b) ? a : b;
        const recv = sender === a ? b : a;
        const kind = (Object.keys(sender.stock) as ResourceKind[])
          .sort((x, y) => sender.stock[y] - sender.stock[x])[0];
        if (sender.stock[kind] < 20) continue;
        const trader = this.membersOf(sender.id).find(
          (m) => m.role === 'worker' && !m.carrying && (m.task === null || m.task.kind === 'wander')
        );
        if (!trader) continue;
        const load = Math.min(sender.stock[kind], 6 + this.techTier(sender, 'trade') * 2);
        sender.stock[kind] -= load;
        trader.carrying = { kind, amount: load };
        trader.task = { kind: 'trade', x: recv.hallX, y: recv.hallY, targetFactionId: recv.id };
        this.hist(trader, `Set out at the head of a caravan of ${kind}, bound for ${recv.settlement}.`);
      }
    }
  }

  private yearTick() {
    for (const f of this.factions) {
      f.popHistory.push(f.alive ? this.factionPop(f.id) : 0);
      if (f.popHistory.length > 60) f.popHistory.shift();
      f.scoreHistory.push(this.factionScore(f));
      if (f.scoreHistory.length > 160) f.scoreHistory.shift(); // an age is ~151 years
    }
    // old paths grass over
    for (const t of this.tiles) {
      if (t.wear) t.wear = Math.floor(t.wear * 0.7);
    }
    for (const a of this.agents) {
      if (!a.alive) continue;
      a.age++;
      if (a.role === 'child' && a.age >= 16) {
        a.role = 'worker';
        a.equipment = outfit('worker');
        this.hist(a, `Came of age and took up work in ${this.factions[a.factionId].settlement}.`);
      }
      if (a.age > 62 && chance((a.age - 62) * 0.02)) {
        this.kill(a, `died of old age at ${a.age}`, null);
        continue;
      }
      if (chance(0.0008)) this.mutate(a, 'The change came unbidden.');
    }
    // the dead return to the earth
    this.corpses = this.corpses.filter((c) => this.year - c.year < 3);

    // and all but the notable dead fade from memory (keeps saved worlds small);
    // this runs on the sim clock so every visitor prunes identically
    const remembered = new Set(this.corpses.map((c) => c.agentId));
    for (const a of this.agents) {
      if (a.alive || remembered.has(a.id) || a.history.length <= 10) continue;
      const notable = a.kills >= 4 || a.crafted >= 25 || a.built >= 8;
      if (!notable) a.history = [...a.history.slice(0, 2), ...a.history.slice(-6)];
    }
  }

  private socialLife() {
    for (const f of this.factions) {
      if (!f.alive) continue;
      const members = this.membersOf(f.id);
      if (members.length < 4) continue;

      // weddings
      if (chance(0.5)) {
        const singles = shuffle(members.filter((m) =>
          m.age >= 18 && (m.spouseId === null || this.agentById(m.spouseId)?.alive === false)
        ));
        if (singles.length >= 2) {
          this.marry(singles[0], singles[1]);
          if (chance(0.3)) this.log('people', `${singles[0].name} and ${singles[1].name} are wed in ${f.settlement}. There is dancing.`);
        }
      }

      // friendships form over shared work
      if (chance(0.7)) {
        const [p, q] = shuffle([...members]);
        if (p && q && p.id !== q.id && !p.friendIds.includes(q.id)) {
          p.friendIds.push(q.id);
          q.friendIds.push(p.id);
          this.hist(p, `Grew close to ${q.name} over a season of shared work.`);
          this.hist(q, `Grew close to ${p.name} over a season of shared work.`);
        }
      }

      // and rivalries fester
      if (chance(0.3)) {
        const [p, q] = shuffle([...members]);
        if (p && q && p.id !== q.id && !p.rivalIds.includes(q.id) && p.spouseId !== q.id) {
          const why = pick(QUARREL_REASONS);
          p.rivalIds.push(q.id);
          q.rivalIds.push(p.id);
          this.hist(p, `Fell out with ${q.name} over ${why}.`);
          this.hist(q, `Fell out with ${p.name} over ${why}.`);
        }
      }
    }
  }

  private growPopulation() {
    for (const f of this.factions) {
      if (!f.alive) continue;
      const pop = this.factionPop(f.id);
      const houses = this.buildings.filter((b) => b.factionId === f.id && b.complete && b.type === 'house').length;
      const hamlets = this.buildings.filter((b) => b.factionId === f.id && b.complete && b.type === 'hamlet').length;
      const cap = 48 + houses * 8 + hamlets * 24;

      if (pop < cap && pop < 220 && f.stock.food > pop * 1.1) {
        let births = 0;
        for (const m of this.membersOf(f.id)) {
          if (births >= 3) break;
          if (m.sex !== 'f' || m.age < 18 || m.age > 45 || m.spouseId === null) continue;
          const h = this.agentById(m.spouseId);
          if (!h || !h.alive) continue;
          if (!chance(0.2)) continue;
          const baby = makeChild(m, h, this.year, this.season, f.settlement);
          this.agents.push(this.register(baby));
          if (chance(0.012)) this.mutate(baby, 'Born strange:');
          this.hist(m, `Gave birth to a ${baby.sex === 'f' ? 'daughter' : 'son'}, ${baby.name}.`);
          this.hist(h, `Became father to ${baby.sex === 'f' ? 'a daughter' : 'a son'}, ${baby.name}.`);
          births++;
          if (chance(0.15)) this.log('people', `A child, ${baby.name}, is born in ${f.settlement}.`);
        }
      }

      // dwindling settlements attract the desperate
      if (pop > 0 && pop < 15 && chance(0.3)) {
        const w = makeAgent(f.id, f.hallX + ri(-2, 2), f.hallY + ri(-2, 2), 'worker', this.year, false);
        this.agents.push(this.register(w));
        this.log('people', `A wanderer, ${w.name}, seeks shelter in ${f.settlement} and is taken in.`);
      }
    }
  }

  private rebalanceRoles() {
    for (const f of this.factions) {
      if (!f.alive) continue;
      const members = this.membersOf(f.id).filter((a) => a.role !== 'leader' && a.role !== 'child');
      const atWar = this.wars.some((w) => w.a === f.id || w.b === f.id);
      const hasBarracks = this.buildings.some((b) => b.factionId === f.id && b.complete && b.type === 'barracks');
      const soldierShare = atWar ? 0.4 : hasBarracks ? 0.25 : 0.18;
      const wantSoldiers = Math.round(members.length * soldierShare);
      const wantBuilders = Math.max(2, Math.round(members.length * 0.1));

      const soldiers = members.filter((a) => a.role === 'soldier');
      const workers = members.filter((a) => a.role === 'worker');

      if (soldiers.length < wantSoldiers) {
        const recruits = workers
          .sort((x, y) => (y.attrs.strength + y.skills['fighting'] * 2) - (x.attrs.strength + x.skills['fighting'] * 2))
          .slice(0, wantSoldiers - soldiers.length);
        for (const r of recruits) {
          r.role = 'soldier';
          r.task = null;
          this.hist(r, atWar ? `Took up the spear when war came to ${f.name}.` : `Was called to stand watch as a soldier.`);
        }
      } else if (soldiers.length > wantSoldiers + 2 && !atWar) {
        for (const s of soldiers.slice(0, soldiers.length - wantSoldiers)) {
          s.role = 'worker';
          s.task = null;
          this.hist(s, `Hung up the spear and returned to honest work.`);
        }
      }

      const builders = members.filter((a) => a.role === 'builder');
      if (builders.length < wantBuilders) {
        const promote = members.filter((a) => a.role === 'worker')
          .sort((x, y) => y.skills['building'] - x.skills['building'])
          .slice(0, wantBuilders - builders.length);
        for (const p of promote) p.role = 'builder';
      }

      const wantMedics = members.length > 15 ? Math.max(1, Math.floor(members.length / 35)) : 0;
      const medics = members.filter((a) => a.role === 'medic');
      if (medics.length < wantMedics) {
        const promote = members.filter((a) => a.role === 'worker')
          .sort((x, y) => (y.skills['medicine'] * 2 + y.attrs.intelligence) - (x.skills['medicine'] * 2 + x.attrs.intelligence))
          .slice(0, wantMedics - medics.length);
        for (const p of promote) {
          p.role = 'medic';
          p.task = null;
          this.hist(p, `Took up the herbs and knives as a healer of ${f.settlement}.`);
        }
      }

      const hasWorkshop = this.buildings.some((b) => b.factionId === f.id && b.complete && b.type === 'workshop');
      const crafters = members.filter((a) => a.role === 'crafter');
      if (hasWorkshop && crafters.length < 2) {
        const promote = members.filter((a) => a.role === 'worker')
          .sort((x, y) => (y.skills['smithing'] * 2 + y.attrs.intelligence + y.attrs.wits) - (x.skills['smithing'] * 2 + x.attrs.intelligence + x.attrs.wits))
          .slice(0, 2 - crafters.length);
        for (const p of promote) {
          p.role = 'crafter';
          p.task = null;
          this.hist(p, `Apprenticed at the workshop of ${f.settlement}.`);
        }
      }
    }
  }

  private politics() {
    const live = this.factions.filter((f) => f.alive);

    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        // slow drift toward neutrality
        const cur = a.relations[b.id] ?? 0;
        let v = cur - Math.sign(cur);

        if (!this.atWar(a.id, b.id) && chance(0.3)) {
          const roll = rand(); // seeded — Math.random() here made every visitor's history diverge
          if (roll < 0.22) {
            v += ri(8, 15);
            this.log('politics', `${a.name} sends gifts of ${pick(['grain', 'worked bronze', 'salt', 'dyed wool'])} to ${b.name}. Relations warm.`);
          } else if (roll < 0.42) {
            v -= ri(8, 16);
            this.log('politics', `Envoys of ${a.name} are ${pick(['insulted', 'turned away at the gates', 'mocked in verse'])} by ${b.name}.`);
          } else if (roll < 0.6) {
            v -= ri(10, 20);
            this.log('politics', `${a.name} and ${b.name} quarrel over ${pick(['a timber boundary', 'grazing rights', 'an unpaid bride-price', 'fishing waters', 'an old blood-debt'])}.`);
          } else if (roll < 0.72 && v > 0) {
            v += ri(15, 25);
            this.log('politics', `A marriage binds a family of ${a.name} to ${b.name}. There is feasting.`);
          }
        }

        v = Math.max(-100, Math.min(100, v));
        a.relations[b.id] = v;
        b.relations[a.id] = v;

        // declarations of war
        if (v < -55 && !this.atWar(a.id, b.id) && chance(0.45)) {
          const wn = warName();
          this.wars.push({ a: a.id, b: b.id, name: wn, startYear: this.year, lossesA: 0, lossesB: 0, weariness: 0 });
          this.log('war', `⚔ ${a.name} declares war on ${b.name}! The chroniclers will call it ${wn}.`);
          for (const m of this.membersOf(a.id)) m.task = null;
          for (const m of this.membersOf(b.id)) m.task = null;
        }
      }
    }

    // wars grind on, and end
    for (const w of [...this.wars]) {
      const fa = this.factions[w.a], fb = this.factions[w.b];

      // a bloody season earns a name in the chronicle
      if ((w.seasonDeaths ?? 0) >= 5 && w.battleX !== undefined && w.battleY !== undefined) {
        let site = 'the open field';
        let bd = Infinity;
        for (const b of this.buildings) {
          if (b.type !== 'hall' && b.type !== 'hamlet') continue;
          const d = Math.abs(b.x - w.battleX) + Math.abs(b.y - (w.battleY ?? 0));
          if (d < bd) { bd = d; site = b.type === 'hall' ? this.factions[b.factionId].settlement : b.name.replace('the hamlet of ', ''); }
        }
        this.log('war', `The Battle of ${site}: ${w.seasonDeaths} fall as ${fa.name} and ${fb.name} clash in ${w.name}.`);
      }
      w.seasonDeaths = 0;

      w.weariness += 1 + Math.floor((w.lossesA + w.lossesB) / 10);
      const popA = this.factionPop(w.a), popB = this.factionPop(w.b);
      if (w.weariness >= 9 || popA < 8 || popB < 8 || !fa.alive || !fb.alive) {
        this.wars = this.wars.filter((x) => x !== w);
        if (fa.alive && fb.alive) {
          const winner = w.lossesA < w.lossesB ? fa : fb;
          const loser = winner === fa ? fb : fa;
          const winnerLosses = winner === fa ? w.lossesA : w.lossesB;
          const loserLosses = winner === fa ? w.lossesB : w.lossesA;
          winner.warsWon++;
          loser.warsLost++;
          fa.relations[fb.id] = -25;
          fb.relations[fa.id] = -25;
          this.log('peace', `${w.name[0].toUpperCase() + w.name.slice(1)} ends after ${this.year - w.startYear < 1 ? 'less than a year' : `${this.year - w.startYear} year(s)`}. ${winner.name} claims the better terms over ${loser.name} (${w.lossesA + w.lossesB} dead).`);
          const tribute = Math.min(20, loser.stock.food);
          loser.stock.food -= tribute;
          winner.stock.food += tribute;

          // a crushing victory takes land, not just grain
          if (loserLosses - winnerLosses >= 10) {
            const hamlet = this.buildings.find((b) => b.factionId === loser.id && b.complete && b.type === 'hamlet');
            if (hamlet) {
              for (const b of this.buildings) {
                if (b.factionId === loser.id && Math.abs(b.x - hamlet.x) + Math.abs(b.y - hamlet.y) <= 8 && b.type !== 'hall') {
                  b.factionId = winner.id;
                }
              }
              this.terrainDirty = true;
              this.log('war', `${winner.name} annexes ${hamlet.name} as the price of peace. Its people now answer to a new banner.`);
            }
          }
        }
      }
    }
  }

  // ---------------- persistence ----------------

  serialize(): string {
    return JSON.stringify({
      v: 7, // v7: fixed faction names (v6: score history; v5: Spanish names; v4: RNG state)
      rngState: getRngState(),
      tiles: this.tiles,
      factions: this.factions,
      agents: this.agents,
      buildings: this.buildings,
      wars: this.wars,
      corpses: this.corpses,
      beasts: this.beasts,
      nextBeastId: this.nextBeastId,
      chronicle: this.chronicle,
      tickCount: this.tickCount,
      year: this.year,
      season: this.season,
      day: this.day,
      nextBuildingId: this.nextBuildingId,
      nextAgentId: getNextAgentId(),
    });
  }

  loadFrom(json: string): boolean {
    try {
      const d = JSON.parse(json);
      if (!d || d.v !== 7 || typeof d.rngState !== 'number') return false;
      this.tiles = d.tiles;
      this.factions = d.factions;
      for (const f of this.factions) {
        f.popHistory = f.popHistory ?? [];
        f.scoreHistory = f.scoreHistory ?? [];
      }
      this.agents = d.agents;
      this.agentMap.clear();
      for (const a of this.agents) this.agentMap.set(a.id, a);
      this.popCache = [];
      this.buildings = d.buildings;
      for (const b of this.buildings) b.builtYear = b.builtYear ?? 1;
      this.wars = d.wars;
      for (const w of this.wars) w.name = w.name ?? warName();
      this.corpses = d.corpses;
      this.beasts = d.beasts ?? [];
      this.nextBeastId = d.nextBeastId ?? 1;
      this.chronicle = d.chronicle;
      this.tickCount = d.tickCount;
      this.year = d.year;
      this.season = d.season;
      this.day = d.day;
      this.nextBuildingId = d.nextBuildingId;
      setNextAgentId(d.nextAgentId);
      setRngState(d.rngState); // last, so nothing above can disturb the restored stream
      this.selectedAgentId = null;
      this.terrainDirty = true;
      return true;
    } catch {
      return false;
    }
  }

  /** the measure of a people at the Judgment: souls, stores, and what they know */
  factionScore(f: Faction): number {
    if (!f.alive) return 0;
    const pop = this.factionPop(f.id);
    const res = Math.floor(f.stock.food + f.stock.wood + f.stock.stone + f.stock.metal);
    const tech = (this.techTier(f, 'war') + this.techTier(f, 'trade') + this.techTier(f, 'science')) * 50;
    const beyond = this.hasTech(f, 'Spaceflight') ? 200 : 0;
    return pop * 10 + res + tech + beyond;
  }

  dateString(): string {
    return `Year ${this.year}, ${seasonName(this.season)} — day ${this.day}`;
  }

  livingCount(): number {
    let n = 0;
    for (const a of this.agents) if (a.alive) n++;
    return n;
  }
}
