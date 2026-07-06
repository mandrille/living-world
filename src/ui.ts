import { Sim } from './sim';
import { Agent, Faction } from './types';
import { W, H } from './world';
import { bodySummary } from './body';
import { itemLabel } from './items';
import { relationLabel } from './factions';
import { seasonName } from './names';
import { Renderer } from './render';
import { t, tg, tr } from './i18n';

type TabName = 'inspect' | 'factions' | 'legends' | 'chronicle';

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export class UI {
  tab: TabName = 'inspect';
  selectedFactionId: number | null = null;
  chronFilter = 'all';
  private panel: HTMLElement;
  private lastRenderKey = '';

  constructor(private sim: Sim, renderer: Renderer) {
    this.panel = document.getElementById('panel')!;

    renderer.onTileClick = (tx, ty) => this.onTile(tx, ty);

    for (const btn of document.querySelectorAll<HTMLButtonElement>('#tabs .tab')) {
      btn.addEventListener('click', () => {
        this.setTab(btn.dataset.tab as TabName);
      });
    }

    // delegation for in-panel links
    this.panel.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-agent-id],[data-faction-id],[data-filter],[data-export],[data-fac-back]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.agentId) {
        this.sim.selectedAgentId = Number(el.dataset.agentId);
        this.setTab('inspect');
      } else if (el.dataset.factionId) {
        this.selectedFactionId = Number(el.dataset.factionId);
        this.setTab('factions');
      } else if (el.dataset.filter) {
        this.chronFilter = el.dataset.filter;
        this.render();
      } else if (el.dataset.export !== undefined) {
        this.exportChronicle();
      } else if (el.dataset.facBack !== undefined) {
        this.selectedFactionId = null;
        this.render();
      }
    });

    this.render();
  }

  setTab(tab: TabName) {
    this.tab = tab;
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#tabs .tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    this.render();
  }

  private onTile(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) {
      this.sim.selectedAgentId = null;
      this.sim.selectedTile = null;
      if (this.tab === 'inspect') this.render();
      return;
    }
    // living agents first
    let best: Agent | null = null;
    let bestD = Infinity;
    for (const a of this.sim.agents) {
      if (!a.alive) continue;
      const d = Math.max(Math.abs(a.x - tx), Math.abs(a.y - ty));
      if (d <= 1 && d < bestD) { bestD = d; best = a; }
    }
    if (best) {
      this.sim.selectedAgentId = best.id;
      this.sim.selectedTile = null;
      this.setTab('inspect');
      return;
    }
    // then the dead where they fell
    for (const corpse of this.sim.corpses) {
      if (Math.max(Math.abs(corpse.x - tx), Math.abs(corpse.y - ty)) <= 1) {
        this.sim.selectedAgentId = corpse.agentId;
        this.sim.selectedTile = null;
        this.setTab('inspect');
        return;
      }
    }
    // otherwise, whatever stands (or grows) here
    this.sim.selectedAgentId = null;
    this.sim.selectedTile = { x: tx, y: ty };
    this.setTab('inspect');
  }

  render() {
    // remember collapsed sections and scroll position across live refreshes,
    // but only while looking at the same thing — a new agent gets fresh defaults
    const renderKey = `${this.tab}:${this.sim.selectedAgentId}:${this.selectedFactionId}`;
    const samePage = renderKey === this.lastRenderKey;
    this.lastRenderKey = renderKey;

    const openState = new Map<string, boolean>();
    for (const d of this.panel.querySelectorAll<HTMLDetailsElement>('details[data-sec]')) {
      openState.set(d.dataset.sec!, d.open);
    }
    const scrollTop = this.panel.scrollTop;

    if (this.tab === 'inspect') this.panel.innerHTML = this.renderInspect();
    else if (this.tab === 'factions') this.panel.innerHTML = this.renderFactions();
    else if (this.tab === 'legends') this.panel.innerHTML = this.renderLegends();
    else this.panel.innerHTML = this.renderChronicle();

    if (samePage) {
      for (const d of this.panel.querySelectorAll<HTMLDetailsElement>('details[data-sec]')) {
        const saved = openState.get(d.dataset.sec!);
        if (saved !== undefined) d.open = saved;
      }
      this.panel.scrollTop = scrollTop;
    }
  }

  private seasonAbbr(s: number): string {
    return t(seasonName(s)).slice(0, 3);
  }

  private yrLabel(year: number, season: number): string {
    return t('Y{y} {s}', { y: year, s: this.seasonAbbr(season) });
  }

  private dateLine(): string {
    return t('Year {y}, {s} — day {d}', { y: this.sim.year, s: t(seasonName(this.sim.season)), d: this.sim.day });
  }

  /** unicode block sparkline of the last `n` values */
  private spark(values: number[], n = 40): string {
    const blocks = '▁▂▃▄▅▆▇█';
    const hist = values.slice(-n);
    if (hist.length < 2) return '';
    const max = Math.max(...hist, 1);
    return hist.map((v) => blocks[Math.min(7, Math.floor((v / max) * 7.99))]).join('');
  }

  private fame(a: Agent): number {
    return a.kills * 3
      + Math.min(15, a.built * 2)
      + Math.min(18, Math.floor(a.crafted / 15))
      + Math.min(10, Math.floor(a.gathered / 60))
      + (a.id === this.sim.factions[a.factionId].leaderId ? 10 : 0)
      + a.equipment.filter((i) => i.artifactName).length * 5
      + Math.min(8, a.grudgeIds.length * 2);
  }

  private epithet(a: Agent): string {
    const f = this.sim.factions[a.factionId];
    if (a.kills >= 8) return tg('the Dreaded', a.sex);
    if (a.id === f.leaderId) return t('the {t}', { t: tr(f.leaderTitle, a.sex) });
    if (a.kills >= 4) return tg('the Blooded', a.sex);
    if (a.crafted >= 40) return tg('the Maker', a.sex);
    if (a.built >= 8) return tg('the Builder', a.sex);
    if (a.gathered >= 250) return tg('the Tireless', a.sex);
    if (a.equipment.some((i) => i.artifactName)) return tg('the Keeper', a.sex);
    return tg('the Quiet', a.sex);
  }

  // ---------------- agent sheet ----------------

  private renderInspect(): string {
    const a = this.sim.agents.find((x) => x.id === this.sim.selectedAgentId);
    if (!a) {
      if (this.sim.selectedTile) {
        return this.renderTile(this.sim.selectedTile.x, this.sim.selectedTile.y);
      }
      return `<p class="muted">${t('Click anything on the map — a person, a tree, a building — to inspect it.')}</p>
        <p class="muted">${t('Drag to pan · scroll wheel to zoom.')}</p>
        <h3>${t('Map key')}</h3>
        <table>
          <tr><td>@</td><td class="muted">${t('worker / builder')}</td></tr>
          <tr><td>†</td><td class="muted">${t('soldier')}</td></tr>
          <tr><td>Ω</td><td class="muted">${t('faction leader')}</td></tr>
          <tr><td>☠</td><td class="muted">${t('the recently dead (click to read their story)')}</td></tr>
          <tr><td>w</td><td class="muted">${t('wolves — dangerous to lone travelers')}</td></tr>
          <tr><td>◆ ◇ ⌂ ▦ ✠ ⚒</td><td class="muted">${t('hall, hamlet, house, farm, barracks, workshop')}</td></tr>
          <tr><td>♠ ▲ * ≡ ≈</td><td class="muted">${t('forest, mountain, ore, farmland, water')}</td></tr>
        </table>
        <p class="muted" style="margin-top:8px">${t('Agents are colored by faction.')}</p>`;
    }

    const f = this.sim.factions[a.factionId];
    const health = bodySummary(a.body);

    // plain numbers; anything past the usual ceiling of 5 glows ember
    const dots = (n: number) => {
      const v = Math.max(0, n);
      return `<span class="rating${v > 5 ? ' over' : ''}">${v}</span>`;
    };
    const boxes = (n: number, max: number, cls = '') => {
      const v = Math.max(0, Math.min(max, n));
      return `<span class="boxes ${cls}">${'■'.repeat(v)}<span class="off">${'□'.repeat(max - v)}</span></span>`;
    };
    const cell = (label: string, value: string) => `<td><span class="lbl">${label}</span>${value}</td>`;

    // ---- header, in the style of the old record-sheets ----
    let html = `<div class="sheet-logo" style="color:${f.color}">${f.symbol} <span class="fac-name" data-faction-id="${f.id}">${f.name}</span> ${f.symbol}</div>`;
    if (!a.alive) html += `<p class="dead-banner">† ${t('dead — {c}', { c: tr(a.deathCause ?? '', a.sex) })}</p>`;
    html += `<table class="sheet-grid">
      <tr>${cell(t('Name'), a.name)}${cell(t('Role'), tg(a.role, a.sex) + (a.id === f.leaderId ? ` · ${tr(f.leaderTitle, a.sex)}` : ''))}${cell(t('Age'), `${a.age}, ${t(a.sex === 'm' ? 'male' : 'female')}`)}</tr>
      <tr>${cell(t('Home'), f.settlement)}${cell(t('Doing'), a.alive && a.task ? this.taskText(a) : a.alive ? t('idle') : '—')}${cell(t('Health'), `<span class="${health.cls}">${t(health.label)}</span>${a.disease ? ` · <span class="bad">${t('sick: {d}', { d: tr(a.disease.name) })}</span>` : ''}`)}</tr>
    </table>`;
    html += `<p class="muted appearance">${cap(tr(a.appearance, a.sex))}.</p>`;

    // ---- attributes ----
    const AT = a.attrs;
    const GROUPS: [string, [string, number][]][] = [
      [t('Physical'), [[t('Strength'), AT.strength], [t('Dexterity'), AT.dexterity], [t('Stamina'), AT.stamina]]],
      [t('Social'), [[t('Charisma'), AT.charisma], [t('Manipulation'), AT.manipulation], [t('Composure'), AT.composure]]],
      [t('Mental'), [[t('Intelligence'), AT.intelligence], [t('Wits'), AT.wits], [t('Resolve'), AT.resolve]]],
    ];
    html += `<h3 class="sheet-h">${t('Attributes')}</h3><div class="cols">`;
    for (const [group, list] of GROUPS) {
      html += `<div class="col"><div class="col-h">${group}</div>` +
        list.map(([n, v]) => `<div class="stat"><span>${n}</span>${dots(v)}</div>`).join('') + `</div>`;
    }
    html += `</div>`;

    // ---- tracks ----
    let hp = 0, maxHp = 0;
    for (const p of a.body) { if (!p.missing) { hp += p.hp; maxHp += p.maxHp; } }
    const renown = Math.min(10, Math.round(this.fame(a) / 5));
    html += `<div class="tracks">
      <span><span class="lbl2">${t('Health')}</span>${boxes(Math.round((hp / Math.max(1, maxHp)) * 10), 10, 'hp')}</span>
      <span><span class="lbl2">${t('Hunger')}</span>${boxes(Math.ceil(a.hunger / 20), 5, 'hunger')}</span>
      <span><span class="lbl2">${t('Renown')}</span>${boxes(renown, 10, 'renown')}</span>
    </div>`;

    // ---- skills ----
    const SKILL_COLS: [string, string[]][] = [
      [t('Field'), ['fighting', 'woodcutting', 'mining', 'farming']],
      [t('Craft'), ['building', 'smithing', 'hauling', 'medicine']],
      [t('Voice'), ['oratory', 'trading']],
    ];
    html += `<h3 class="sheet-h">${t('Skills')}</h3><div class="cols">`;
    for (const [group, list] of SKILL_COLS) {
      html += `<div class="col"><div class="col-h">${group}</div>` +
        list.map((s) => `<div class="stat"><span>${t(s)}</span>${dots(a.skills[s] ?? 0)}</div>`).join('') + `</div>`;
    }
    html += `</div>`;

    // ---- collapsible detail sections ----
    if (a.mutations.length > 0) {
      html += `<details data-sec="mut" open><summary>${t('Mutations')} — <span class="warn">${a.mutations.length}</span></summary><ul>` +
        a.mutations.map((m) =>
          `<li><span class="${m.good ? 'good' : 'bad'}">${tr(m.name)}</span> — <span class="muted">${tr(m.desc)}</span>${m.contagious ? ` <span class="bad">${t('(contagious)')}</span>` : ''}</li>`
        ).join('') + `</ul></details>`;
    }

    html += `<details data-sec="mind" open><summary>${t('Mind & bonds')}</summary>
      <p><span class="muted">${t('Traits:')}</span> ${a.personality.map((p) => tr(p, a.sex)).join('; ')}.</p>
      <p>${a.name} ${tr(a.belief, a.sex)}.</p>` + this.renderBonds(a) + `</details>`;

    let gear = '';
    if (a.equipment.length === 0) gear = `<p class="muted">${t('Nothing but the clothes on their back.')}</p>`;
    else {
      gear = `<ul>` + a.equipment.map((i) =>
        `<li>${cap(tr(itemLabel(i)))} <span class="muted">[${i.slot === 'weapon' ? t('atk {n}', { n: i.power }) : i.slot === 'trinket' ? t('trinket') : t('def {n}', { n: i.power })}] — ${tr(i.story)}</span></li>`
      ).join('') + `</ul>`;
    }
    if (a.carrying) gear += `<p>${t('Hauling {n} of {r}.', { n: a.carrying.amount, r: tr(a.carrying.kind) })}</p>`;
    html += `<details data-sec="gear" open><summary>${t('Wearing & carrying')}</summary>${gear}</details>`;

    // only the parts with something to report
    const hurt = a.body.filter((p) => p.missing || p.hp < p.maxHp || p.wounds.length > 0);
    if (hurt.length === 0) {
      html += `<details data-sec="body"><summary>${t('Body')} — <span class="good">${t('whole and unwounded')}</span></summary>
        <p class="muted">${t('All {n} parts sound; not a scar worth mentioning.', { n: a.body.length })}</p></details>`;
    } else {
      const marked = hurt.length > 1 ? t('{n} parts marked', { n: hurt.length }) : t('{n} part marked', { n: hurt.length });
      html += `<details data-sec="body" open><summary>${t('Body')} — <span class="${health.cls}">${t(health.label)}</span>, ${marked}</summary><table class="body-table">`;
      for (const p of hurt) {
        let status: string;
        if (p.missing) status = `<span class="bad">${t('MISSING')}</span>`;
        else if (p.hp <= p.maxHp * 0.35) status = `<span class="bad">${t('mangled')}</span>`;
        else if (p.hp < p.maxHp) status = `<span class="warn">${t('hurt')}</span>`;
        else status = `<span class="muted">${t('scarred')}</span>`;
        const wounds = p.wounds.length ? ` <span class="muted">— ${p.wounds.map((w) => tr(w)).join('; ')}</span>` : '';
        html += `<tr><td>${tr(p.name)}</td><td>${status}${wounds}</td></tr>`;
      }
      html += `</table></details>`;
    }

    html += `<details data-sec="life" open><summary>${t('Life & deeds')}</summary>
      <p class="muted">${t('Kills: {k} · Loads gathered: {g} · Buildings raised: {b} · Works forged: {c}', { k: a.kills, g: a.gathered, b: a.built, c: a.crafted })}</p>
      <div class="hist">` + a.history.map((h) =>
        `<p><span class="yr">${this.yrLabel(h.year, h.season)}</span>${tr(h.text, a.sex)}</p>`
      ).join('') + `</div></details>`;

    return html;
  }

  private renderBonds(a: Agent): string {
    const link = (o: Agent) => `<span class="agent-link" data-agent-id="${o.id}">${o.name}</span>${o.alive ? '' : ` <span class="muted">${t('(dead)')}</span>`}`;
    const byId = (id: number) => this.sim.agents.find((x) => x.id === id);
    const parts: string[] = [];

    const mother = a.motherId !== null ? byId(a.motherId) : undefined;
    const father = a.fatherId !== null ? byId(a.fatherId) : undefined;
    if (mother || father) {
      const ps = [father, mother].filter((p): p is Agent => !!p).map(link);
      parts.push(t('Child of {p}.', { p: ps.join(t(' and ')) }));
    }

    const spouse = a.spouseId !== null ? byId(a.spouseId) : undefined;
    if (spouse) {
      parts.push(spouse.alive
        ? t('Married to {n}.', { n: link(spouse) })
        : `<span class="muted">${t('Widowed — was married to {n}.', { n: link(spouse) })}</span>`);
    }
    const children = a.childIds.map(byId).filter((o): o is Agent => !!o);
    if (children.length) parts.push(t('Children: {n}.', { n: children.map(link).join(', ') }));

    const friends = a.friendIds.map(byId).filter((o): o is Agent => !!o);
    if (friends.length) parts.push(t('Friends: {n}.', { n: friends.map(link).join(', ') }));
    const rivals = a.rivalIds.map(byId).filter((o): o is Agent => !!o);
    if (rivals.length) parts.push(t('Rivals: {n}.', { n: rivals.map(link).join(', ') }));
    const grudges = a.grudgeIds.map(byId).filter((o): o is Agent => !!o);
    for (const g of grudges) {
      parts.push(`<span class="bad">${t('Has sworn a blood-oath against {n} of {f}.', { n: link(g), f: this.sim.factions[g.factionId].name })}</span>`);
    }
    if (parts.length === 0) return `<p class="muted">${t('Keeps to themselves.')}</p>`;
    return `<p>${parts.join('<br>')}</p>`;
  }

  // ---------------- tile inspector ----------------

  private renderTile(x: number, y: number): string {
    const sim = this.sim;
    const tl = sim.tiles[y * W + x];
    // deterministic per-tile flavor: no rng consumed, same for every visitor
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const pickH = <T,>(arr: T[], salt = 0): T => arr[(h + salt * 2654435761) % arr.length];

    const b = sim.buildingAt(x, y);
    if (b) {
      const f = sim.factions[b.factionId];
      const title = cap(tr(b.name));
      let html = `<div class="sheet-logo" style="color:${f.color}">${f.symbol} <span class="fac-name" data-faction-id="${f.id}">${f.name}</span> ${f.symbol}</div>`;
      html += `<h2>${title}</h2>`;
      if (b.complete) {
        const bAge = sim.year - b.builtYear;
        html += `<p>${bAge <= 0
          ? t('Raised in Year {y} — new this year, the timber still bleeding sap.', { y: b.builtYear })
          : bAge === 1
            ? t('Raised in Year {y} — {n} year old.', { y: b.builtYear, n: bAge })
            : t('Raised in Year {y} — {n} years old.', { y: b.builtYear, n: bAge })}</p>`;
      } else {
        html += `<p class="warn">${t('Under construction — {p}% raised.', { p: Math.floor((b.progress / Math.max(1, b.workNeeded)) * 100) })} ${b.progress > 0 && b.builtYear > 0 ? t('Wrecked once, being rebuilt.') : t('The frame stands open to the sky.')}</p>`;
      }
      const FLAVOR: Record<string, string> = {
        hall: t('The heart of {s}. Every oath in this land was sworn under these beams.', { s: f.settlement }),
        hamlet: t('A young settlement of {f}. The palisade is still pale, unweathered wood.', { f: f.name }),
        house: pickH([t('Smoke curls from the chimney.'), t('Herbs dry under the eaves.'), t('A dog sleeps in the doorway.'), t('Someone argues inside, quietly.')]),
        farm: `${t('They grow {c} here.', { c: t(pickH(['barley', 'rye', 'turnips', 'flax', 'beans'])) })} ${pickH([t("The scarecrow wears a soldier's old helm."), t('The rows are crooked but honest.'), t('Crows watch from the fence.')])}`,
        barracks: pickH([t('Spears racked by the door, boots by the wall.'), t('The training yard is packed dirt, dark in patches.')]),
        workshop: pickH([t('It smells of hot metal and oak shavings.'), t('The anvil rings from first light to last.')]),
      };
      html += `<p class="muted">${FLAVOR[b.type] ?? ''}</p>`;
      return html;
    }

    // bare terrain
    let title = '';
    let lines: string[] = [];
    switch (tl.terrain) {
      case 'forest': {
        const species = pickH(['an old oak', 'a black pine', 'a silver birch', 'a gnarled yew', 'a rowan', 'an alder', 'a hollow ash']);
        const treeAge = 60 + (h % 340);
        title = t('Forest — {t}', { t: t(species) });
        lines.push(treeAge > sim.year
          ? t('This one is roughly {n} years old — it was here long before the first hall.', { n: treeAge })
          : t('This one is roughly {n} years old — it was a sapling within living memory.', { n: treeAge }));
        lines.push(t('Timber left in this stand: {n}.', { n: tl.amount }));
        lines.push(pickH([t('Moss thickens on the north side.'), t('Something has clawed the bark, high up.'), t('Initials are carved here, grown smooth with age.'), t('A woodpecker works somewhere above.')], 1));
        break;
      }
      case 'grass': {
        const worn = (tl.wear ?? 0) > 90;
        title = worn ? t('A trodden road') : t('Open grassland');
        if (worn) lines.push(t('Countless feet have beaten this path bare — a road that no one built and everyone made.'));
        else lines.push(pickH([
          t('Knee-high grass, humming with insects.'),
          t('Wildflowers here: {f}.', { f: t(pickH(['yarrow and cornflower', 'poppies', 'clover, thick with bees'], 2)) }),
          t('A hare bolts as you look.'),
        ], 1));
        break;
      }
      case 'mountain': {
        title = t('Mountains — {t}', { t: t(pickH(['grey granite', 'pale limestone', 'dark slate', 'rough gneiss'])) });
        lines.push(t('Stone to quarry: {n}.', { n: tl.amount }));
        lines.push(pickH([t('Wind whistles through the crags.'), t('A cairn of stacked stones marks... something.'), t('Goats watch from ledges no one can reach.')], 1));
        break;
      }
      case 'ore': {
        title = t('Ore vein — {t}', { t: t(pickH(['iron-red seams', 'green-streaked copper', 'dull grey tin'])) });
        lines.push(t('Metal left in the vein: {n}.', { n: tl.amount }));
        lines.push(t("Miners' tailings spill down the slope below."));
        break;
      }
      case 'water': {
        title = t('Deep water');
        lines.push(pickH([
          t('Cold, dark, and older than any faction.'),
          t('Fish rise at dusk. The elders say the dead watch from below.'),
          t('The surface gives back the sky and keeps its own counsel.'),
        ]));
        break;
      }
      case 'farmland': {
        const crop = pickH(['barley', 'rye', 'turnips', 'flax', 'beans']);
        title = t('Field — {c}', { c: t(crop) });
        lines.push(tl.amount === 0
          ? t('Stripped bare, or drowned by flood. The furrows wait for another season.')
          : tl.amount >= 9
            ? t('The {c} crop stands tall and ready ({n}/12).', { c: t(crop), n: tl.amount })
            : tl.amount >= 5
              ? t('The {c} crop stands half-grown ({n}/12).', { c: t(crop), n: tl.amount })
              : t('The {c} crop stands in first green shoots ({n}/12).', { c: t(crop), n: tl.amount }));
        break;
      }
      case 'crater': {
        title = t('Glass crater');
        lines.push(t('The ground here is fused smooth and faintly warm. Nothing grows.'));
        lines.push(`<span class="bad">${t('Those who linger are changed by it.')}</span>`);
        break;
      }
    }
    let html = `<h2>${title}</h2>`;
    html += `<p class="muted">${t('at ({x}, {y}) — near {s}', { x, y, s: this.nearestSettlementLabel(x, y) })}</p>`;
    for (const l of lines) html += `<p>${l}</p>`;
    return html;
  }

  private nearestSettlementLabel(x: number, y: number): string {
    let best = t('no settlement at all');
    let bd = Infinity;
    for (const b of this.sim.buildings) {
      if (b.type !== 'hall' && b.type !== 'hamlet') continue;
      const d = Math.abs(b.x - x) + Math.abs(b.y - y);
      if (d < bd) {
        bd = d;
        const f = this.sim.factions[b.factionId];
        best = t('{s} ({d} tiles)', { s: b.type === 'hall' ? f.settlement : b.name.replace('the hamlet of ', ''), d });
      }
    }
    return best;
  }

  private taskText(a: Agent): string {
    const tk = a.task!;
    switch (tk.kind) {
      case 'gather': return t('gathering {r} at ({x},{y})', { r: tr(tk.resource ?? ''), x: tk.x, y: tk.y });
      case 'deposit': return t('hauling goods back to the hall');
      case 'build': return t('working on a construction site');
      case 'raid': return t('marching to war');
      case 'patrol': return t('standing watch');
      case 'eat': return t('looking for a meal');
      case 'wander': return t('wandering');
      case 'flee': return t('fleeing from battle');
      case 'craft': return t('at work in the workshop');
      case 'trade': return t('leading a caravan');
      case 'heal': return t('tending the sick');
    }
  }

  // ---------------- factions ----------------

  private renderFactions(): string {
    const f = this.selectedFactionId !== null ? this.sim.factions[this.selectedFactionId] : null;
    return f ? this.renderFactionSheet(f) : this.renderFactionRoster();
  }

  private renderFactionRoster(): string {
    let html = `<h2>${t('The Peoples of the World')}</h2>
      <p class="muted">${t('Click a people to open their sheet.')}</p><table>`;
    const ranked = [...this.sim.factions].sort((a, b) => this.sim.factionScore(b) - this.sim.factionScore(a));
    html += `<tr><th></th><th>${t('People')}</th><th>${t('Souls')}</th><th>${t('Score')}</th><th></th></tr>`;
    for (const f of ranked) {
      html += `<tr>
        <td style="color:${f.color}">${f.symbol}</td>
        <td><span class="fac-name" data-faction-id="${f.id}" style="color:${f.color}">${f.name}</span>${f.alive ? '' : ' <span class="bad">†</span>'}</td>
        <td>${this.sim.factionPop(f.id)}</td>
        <td class="muted">${this.sim.factionScore(f)}</td>
        <td class="muted" style="color:${f.color}">${this.spark(f.scoreHistory, 24)}</td></tr>`;
    }
    html += `</table>`;
    return html;
  }

  /** a people's character sheet: its ratings rise and fall with what its members do */
  private renderFactionSheet(f: Faction): string {
    const sim = this.sim;
    const members = sim.membersOf(f.id);
    const leader = sim.agentById(f.leaderId);
    const pop = sim.factionPop(f.id);
    const cell = (label: string, value: string) => `<td><span class="lbl">${label}</span>${value}</td>`;
    const rate = (n: number) => `<span class="rating${n > 9 ? ' over' : ''}">${n}</span>`;

    // live attributes, computed from the deeds and state of their people
    const soldiers = members.filter((m) => m.role === 'soldier' || m.role === 'leader');
    const avgFight = soldiers.length ? soldiers.reduce((s, m) => s + m.skills['fighting'], 0) / soldiers.length : 0;
    const workshops = sim.buildings.filter((b) => b.factionId === f.id && b.complete && b.type === 'workshop').length;
    const crafted = members.reduce((s, m) => s + m.crafted, 0);
    const stock = f.stock.food + f.stock.wood + f.stock.stone + f.stock.metal;
    const artifacts = members.reduce((s, m) => s + m.equipment.filter((i) => i.artifactName).length, 0);
    const topFame = members.map((m) => this.fame(m)).sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
    const hale = members.filter((m) => !m.disease && !m.body.some((p) => p.missing)).length;

    const might = Math.round(soldiers.length / 4 + sim.techTier(f, 'war') * 2 + avgFight);
    const craft = Math.round(workshops * 2 + members.filter((m) => m.role === 'crafter').length + crafted / 60);
    const wealth = Math.round(stock / 60 + sim.techTier(f, 'trade') * 2);
    const lore = f.research.done.length + sim.techTier(f, 'science');
    const renown = Math.round(topFame / 8 + f.warsWon * 2 + artifacts);
    const vigor = members.length ? Math.round((hale / members.length) * 10) : 0;

    let html = `<p><span class="fac-name muted" data-fac-back>${t('← all peoples')}</span></p>`;
    html += `<div class="sheet-logo" style="color:${f.color}">${f.symbol} ${f.name} ${f.symbol}</div>`;
    if (!f.alive) html += `<p class="dead-banner">${t('† destroyed — their halls stand silent')}</p>`;
    html += `<table class="sheet-grid">
      <tr>${cell(t('Seat'), f.settlement)}${cell(t('Rule'), tr(f.government))}${cell(t('Souls'), String(pop))}</tr>
      <tr>${cell(t('Leader'), leader
        ? `<span class="agent-link" data-agent-id="${leader.id}">${leader.name}</span>`
        : `<span class="muted">${t('none')}</span>`)}${cell(t('Founded'), t('Year 1 ({n}y ago)', { n: sim.year - 1 }))}${cell(t('Wars'), t('{w}W / {l}L', { w: f.warsWon, l: f.warsLost }))}</tr>
    </table>`;

    html += `<h3 class="sheet-h">${t("The People's Measure")}</h3><div class="cols">`;
    const groups: [string, [string, number][]][] = [
      [t('Arms'), [[t('Might'), might], [t('Renown'), renown]]],
      [t('Hands'), [[t('Craft'), craft], [t('Wealth'), wealth]]],
      [t('Mind'), [[t('Lore'), lore], [t('Vigor'), vigor]]],
    ];
    for (const [g, list] of groups) {
      html += `<div class="col"><div class="col-h">${g}</div>` +
        list.map(([n, v]) => `<div class="stat"><span>${n}</span>${rate(v)}</div>`).join('') + `</div>`;
    }
    html += `</div>`;
    html += `<p class="muted" style="font-size:11px">${t("Might grows with soldiers' skill and war-craft · Craft with workshops and works forged ({c}) · Wealth with stores ({s}) · Lore with knowledge · Renown with famous deeds · Vigor with the health of the people.", { c: crafted, s: Math.floor(stock) })}</p>`;

    // the great houses: surnames with at least a handful of living members
    const houses = new Map<string, number>();
    for (const m of members) houses.set(m.surname, (houses.get(m.surname) ?? 0) + 1);
    const topHouses = [...houses.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (topHouses.length) {
      html += `<p><span class="muted">${t('Great families:')}</span> ${topHouses.map(([s, n]) => `${s} (${n})`).join(' · ')}</p>`;
    }

    const kills = members.reduce((s, m) => s + m.kills, 0);
    const gathered = members.reduce((s, m) => s + m.gathered, 0);
    const deedsKey = artifacts === 1
      ? '{k} foes slain · {g} loads hauled · {c} works forged · {a} named artifact borne'
      : '{k} foes slain · {g} loads hauled · {c} works forged · {a} named artifacts borne';
    html += `<p><span class="muted">${t('Deeds of the living:')}</span> ${t(deedsKey, { k: kills, g: gathered, c: crafted, a: artifacts })}</p>`;

    if (f.popHistory.length > 1) {
      html += `<p class="muted">${t('souls over time: {s} (peak {n})', { s: `<span class="good">${this.spark(f.popHistory)}</span>`, n: Math.max(...f.popHistory.slice(-40), 1) })}</p>`;
    }
    if (f.scoreHistory.length > 1) {
      html += `<p class="muted">${t('score over time: {s} (now {n})', { s: `<span style="color:${f.color}">${this.spark(f.scoreHistory)}</span>`, n: sim.factionScore(f) })}</p>`;
    }

    // stock & knowledge
    html += `<p>${t('Stores: food {f}, wood {w}, stone {s}, metal {m}', { f: Math.floor(f.stock.food), w: f.stock.wood, s: f.stock.stone, m: f.stock.metal })}</p>`;
    if (f.research.done.length > 0 || f.research.branch) {
      const branchName = f.research.branch === 'war' ? t('the arts of war')
        : f.research.branch === 'trade' ? t('commerce') : f.research.branch === 'science' ? t('natural philosophy') : '—';
      html += `<p><span class="muted">${t('Knowledge:')}</span> ${f.research.done.length ? f.research.done.map((n) => cap(tr(n))).join(', ') : t('none yet')}`;
      if (f.alive && f.research.branch) html += ` <span class="muted">${t('· pursuing {b}', { b: branchName })}</span>`;
      html += `</p>`;
    }

    // standing with the others
    const rels: string[] = [];
    for (const o of this.sim.factions) {
      if (o.id === f.id || !o.alive || !f.alive) continue;
      const war = sim.wars.find((w) => (w.a === f.id && w.b === o.id) || (w.b === f.id && w.a === o.id));
      if (war) {
        rels.push(`<span class="rel-war">${t('fighting {w} against {f}', { w: tr(war.name), f: o.name })}</span>`);
      } else {
        const r = relationLabel(f.relations[o.id] ?? 0);
        rels.push(t('{r} with {f}', {
          r: `<span class="${r.cls}">${t(r.label)}</span>`,
          f: `<span class="fac-name" data-faction-id="${o.id}" style="color:${o.color}">${o.name}</span>`,
        }));
      }
    }
    if (rels.length) html += `<p>${rels.join(' · ')}</p>`;

    // notables
    const notables = members
      .map((a) => ({ a, fame: this.fame(a) }))
      .sort((x, y) => y.fame - x.fame)
      .slice(0, 5)
      .filter((x) => x.fame > 0);
    if (notables.length) {
      html += `<p>${t('Notables: ')}${notables.map(({ a }) =>
        `<span class="agent-link" data-agent-id="${a.id}">${a.name}</span> <em class="muted">${this.epithet(a)}</em>`
      ).join(' · ')}</p>`;
    }

    // what their people have done lately
    const doings = this.sim.chronicle.filter((c) => c.text.includes(f.name)).slice(0, 6);
    if (doings.length) {
      html += `<details data-sec="fac-doings" open><summary>${t('Lately, their people…')}</summary><div class="hist">` +
        doings.map((c) => `<p><span class="yr">${this.yrLabel(c.year, c.season)}</span>${tr(c.text)}</p>`).join('') +
        `</div></details>`;
    }

    html += `<details data-sec="fac-lore"><summary>${t('Myth & creed')}</summary>
      <p><em>${tr(f.myth)}</em></p><p>${t('They {e}.', { e: tr(f.ethos) })}</p></details>`;

    return html;
  }

  private exportChronicle() {
    const lines: string[] = [t('THE CHRONICLE OF THE WORLD'), t('as of {d}', { d: this.dateLine() }), ''];
    for (const c of [...this.sim.chronicle].reverse()) {
      lines.push(t('Year {y}, {s} — {t}', { y: c.year, s: t(seasonName(c.season)), t: tr(c.text) }));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chronicle-year-${this.sim.year}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ---------------- legends ----------------

  private renderLegends(): string {
    const link = (a: Agent) => `<span class="agent-link" data-agent-id="${a.id}">${a.name}</span>`;
    const figures = this.sim.agents
      .map((a) => ({ a, fame: this.fame(a) }))
      .filter((x) => x.fame > 2)
      .sort((x, y) => y.fame - x.fame)
      .slice(0, 15);

    let html = `<h2>${t('Figures of Legend')}</h2>`;
    if (figures.length === 0) {
      html += `<p class="muted">${t('No one has yet done anything worth a song.')}</p>`;
    } else {
      html += `<div class="hist">` + figures.map(({ a, fame }) => {
        const f = this.sim.factions[a.factionId];
        const status = a.alive ? '' : ' <span class="muted">†</span>';
        return `<p><span style="color:${f.color}">${f.symbol}</span> ${link(a)} <em>${this.epithet(a)}</em>${status}
          <span class="muted">${t('— {k} kills, {b} raised, {c} forged (renown {f})', { k: a.kills, b: a.built, c: a.crafted, f: fame })}</span></p>`;
      }).join('') + `</div>`;
    }

    // named artifacts and where they are now
    const artifacts: { label: string; holder: Agent }[] = [];
    for (const a of this.sim.agents) {
      for (const i of a.equipment) {
        if (i.artifactName) artifacts.push({ label: cap(tr(itemLabel(i))), holder: a });
      }
    }
    html += `<h3>${t('Named works')}</h3>`;
    if (artifacts.length === 0) {
      html += `<p class="muted">${t('No masterworks have been forged yet.')}</p>`;
    } else {
      html += `<ul>` + artifacts.slice(0, 20).map(({ label, holder }) => {
        const f = this.sim.factions[holder.factionId];
        return `<li>${label} — ${holder.alive
          ? t('borne by {n} of {f}', { n: link(holder), f: `<span style="color:${f.color}">${f.name}</span>` })
          : `<span class="muted">${t('lost with the body of {n}', { n: link(holder) })}</span>`}</li>`;
      }).join('') + `</ul>`;
    }
    return html;
  }

  // ---------------- chronicle ----------------

  private renderChronicle(): string {
    if (this.sim.chronicle.length === 0) return `<p class="muted">${t('Nothing of note has happened yet.')}</p>`;
    const cls: Record<string, string> = {
      war: 'bad', peace: 'good', politics: '', death: 'muted', building: 'muted', people: 'muted', misc: 'muted', disaster: 'warn',
    };
    const FILTERS: Record<string, string[] | null> = {
      all: null,
      war: ['war', 'peace'],
      politics: ['politics'],
      people: ['people', 'misc'],
      deaths: ['death', 'disaster'],
      building: ['building'],
    };
    const allowed = FILTERS[this.chronFilter] ?? null;
    const entries = this.sim.chronicle.filter((c) => !allowed || allowed.includes(c.kind));

    const btn = (id: string, label: string) =>
      `<button class="tab chron-filter ${this.chronFilter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`;
    let html = `<h2>${t('Chronicle of the World')}</h2>`;
    html += `<div class="filters">${btn('all', t('All'))}${btn('war', t('⚔ Wars'))}${btn('politics', t('Politics'))}${btn('people', t('People'))}${btn('deaths', t('Deaths'))}${btn('building', t('Works'))}<button class="tab chron-filter" data-export title="${t('download the chronicle as text')}">${t('⤓ Export')}</button></div>`;
    html += entries.length === 0
      ? `<p class="muted">${t('Nothing of that kind has happened yet.')}</p>`
      : `<div class="hist">` + entries.map((c) =>
          `<p><span class="yr">${this.yrLabel(c.year, c.season)}</span><span class="${cls[c.kind] ?? ''}">${tr(c.text)}</span></p>`
        ).join('') + `</div>`;
    return html;
  }
}
