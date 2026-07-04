import { Sim } from './sim';
import { Agent, Faction } from './types';
import { bodySummary } from './body';
import { SKILLS } from './agents';
import { itemLabel } from './items';
import { relationLabel } from './factions';
import { seasonName } from './names';
import { Renderer } from './render';

type TabName = 'inspect' | 'factions' | 'legends' | 'chronicle';

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
      const el = (e.target as HTMLElement).closest('[data-agent-id],[data-faction-id],[data-filter]') as HTMLElement | null;
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
      this.setTab('inspect');
      return;
    }
    // then the dead where they fell
    for (const corpse of this.sim.corpses) {
      if (Math.max(Math.abs(corpse.x - tx), Math.abs(corpse.y - ty)) <= 1) {
        this.sim.selectedAgentId = corpse.agentId;
        this.setTab('inspect');
        return;
      }
    }
    const b = this.sim.buildingAt(tx, ty);
    if (b) {
      this.selectedFactionId = b.factionId;
      this.setTab('factions');
      return;
    }
    this.sim.selectedAgentId = null;
    if (this.tab === 'inspect') this.render();
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
    if (a.kills >= 8) return 'the Dreaded';
    if (a.id === f.leaderId) return `the ${f.leaderTitle}`;
    if (a.kills >= 4) return 'the Blooded';
    if (a.crafted >= 40) return 'the Maker';
    if (a.built >= 8) return 'the Builder';
    if (a.gathered >= 250) return 'the Tireless';
    if (a.equipment.some((i) => i.artifactName)) return 'the Keeper';
    return 'the Quiet';
  }

  // ---------------- agent sheet ----------------

  private renderInspect(): string {
    const a = this.sim.agents.find((x) => x.id === this.sim.selectedAgentId);
    if (!a) {
      return `<p class="muted">Click an agent on the map to inspect them.</p>
        <p class="muted">Drag to pan · scroll wheel to zoom.</p>
        <h3>Map key</h3>
        <table>
          <tr><td>@</td><td class="muted">worker / builder</td></tr>
          <tr><td>†</td><td class="muted">soldier</td></tr>
          <tr><td>Ω</td><td class="muted">faction leader</td></tr>
          <tr><td>☠</td><td class="muted">the recently dead (click to read their story)</td></tr>
          <tr><td>w</td><td class="muted">wolves — dangerous to lone travelers</td></tr>
          <tr><td>◆ ◇ ⌂ ▦ ✠ ⚒</td><td class="muted">hall, hamlet, house, farm, barracks, workshop</td></tr>
          <tr><td>♠ ▲ * ≡ ≈</td><td class="muted">forest, mountain, ore, farmland, water</td></tr>
        </table>
        <p class="muted" style="margin-top:8px">Agents are colored by faction.</p>`;
    }

    const f = this.sim.factions[a.factionId];
    const health = bodySummary(a.body);
    const hungerLabel = a.hunger >= 100 ? '<span class="bad">starving</span>'
      : a.hunger > 70 ? '<span class="warn">hungry</span>' : '<span class="good">fed</span>';

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
    if (!a.alive) html += `<p class="dead-banner">† dead — ${a.deathCause}</p>`;
    html += `<table class="sheet-grid">
      <tr>${cell('Name', a.name)}${cell('Role', a.role + (a.id === f.leaderId ? ` · ${f.leaderTitle}` : ''))}${cell('Age', `${a.age}, ${a.sex === 'm' ? 'male' : 'female'}`)}</tr>
      <tr>${cell('Home', f.settlement)}${cell('Doing', a.alive && a.task ? this.taskText(a) : a.alive ? 'idle' : '—')}${cell('Health', `<span class="${health.cls}">${health.label}</span>${a.disease ? ` · <span class="bad">sick: ${a.disease.name}</span>` : ''}`)}</tr>
    </table>`;
    html += `<p class="muted appearance">${a.appearance}.</p>`;

    // ---- attributes ----
    const AT = a.attrs;
    const GROUPS: [string, [string, number][]][] = [
      ['Physical', [['Strength', AT.strength], ['Dexterity', AT.dexterity], ['Stamina', AT.stamina]]],
      ['Social', [['Charisma', AT.charisma], ['Manipulation', AT.manipulation], ['Composure', AT.composure]]],
      ['Mental', [['Intelligence', AT.intelligence], ['Wits', AT.wits], ['Resolve', AT.resolve]]],
    ];
    html += `<h3 class="sheet-h">Attributes</h3><div class="cols">`;
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
      <span><span class="lbl2">Health</span>${boxes(Math.round((hp / Math.max(1, maxHp)) * 10), 10, 'hp')}</span>
      <span><span class="lbl2">Hunger</span>${boxes(Math.ceil(a.hunger / 20), 5, 'hunger')}</span>
      <span><span class="lbl2">Renown</span>${boxes(renown, 10, 'renown')}</span>
    </div>`;

    // ---- skills ----
    const SKILL_COLS: [string, string[]][] = [
      ['Field', ['fighting', 'woodcutting', 'mining', 'farming']],
      ['Craft', ['building', 'smithing', 'hauling', 'medicine']],
      ['Voice', ['oratory', 'trading']],
    ];
    html += `<h3 class="sheet-h">Skills</h3><div class="cols">`;
    for (const [group, list] of SKILL_COLS) {
      html += `<div class="col"><div class="col-h">${group}</div>` +
        list.map((s) => `<div class="stat"><span>${s}</span>${dots(a.skills[s] ?? 0)}</div>`).join('') + `</div>`;
    }
    html += `</div>`;

    // ---- collapsible detail sections ----
    if (a.mutations.length > 0) {
      html += `<details data-sec="mut" open><summary>Mutations — <span class="warn">${a.mutations.length}</span></summary><ul>` +
        a.mutations.map((m) =>
          `<li><span class="${m.good ? 'good' : 'bad'}">${m.name}</span> — <span class="muted">${m.desc}</span>${m.contagious ? ' <span class="bad">(contagious)</span>' : ''}</li>`
        ).join('') + `</ul></details>`;
    }

    html += `<details data-sec="mind" open><summary>Mind & bonds</summary>
      <p><span class="muted">Traits:</span> ${a.personality.join('; ')}.</p>
      <p>${a.name} ${a.belief}.</p>` + this.renderBonds(a) + `</details>`;

    let gear = '';
    if (a.equipment.length === 0) gear = `<p class="muted">Nothing but the clothes on their back.</p>`;
    else {
      gear = `<ul>` + a.equipment.map((i) =>
        `<li>${itemLabel(i)} <span class="muted">[${i.slot === 'weapon' ? `atk ${i.power}` : i.slot === 'trinket' ? 'trinket' : `def ${i.power}`}] — ${i.story}</span></li>`
      ).join('') + `</ul>`;
    }
    if (a.carrying) gear += `<p>Hauling ${a.carrying.amount} ${a.carrying.kind}.</p>`;
    html += `<details data-sec="gear" open><summary>Wearing & carrying</summary>${gear}</details>`;

    // only the parts with something to report
    const hurt = a.body.filter((p) => p.missing || p.hp < p.maxHp || p.wounds.length > 0);
    if (hurt.length === 0) {
      html += `<details data-sec="body"><summary>Body — <span class="good">whole and unwounded</span></summary>
        <p class="muted">All ${a.body.length} parts sound; not a scar worth mentioning.</p></details>`;
    } else {
      html += `<details data-sec="body" open><summary>Body — <span class="${health.cls}">${health.label}</span>, ${hurt.length} part${hurt.length > 1 ? 's' : ''} marked</summary><table class="body-table">`;
      for (const p of hurt) {
        let status: string;
        if (p.missing) status = `<span class="bad">MISSING</span>`;
        else if (p.hp <= p.maxHp * 0.35) status = `<span class="bad">mangled</span>`;
        else if (p.hp < p.maxHp) status = `<span class="warn">hurt</span>`;
        else status = `<span class="muted">scarred</span>`;
        const wounds = p.wounds.length ? ` <span class="muted">— ${p.wounds.join('; ')}</span>` : '';
        html += `<tr><td>${p.name}</td><td>${status}${wounds}</td></tr>`;
      }
      html += `</table></details>`;
    }

    html += `<details data-sec="life" open><summary>Life & deeds</summary>
      <p class="muted">Kills: ${a.kills} · Loads gathered: ${a.gathered} · Buildings raised: ${a.built} · Works forged: ${a.crafted}</p>
      <div class="hist">` + a.history.map((h) =>
        `<p><span class="yr">Y${h.year} ${seasonName(h.season).slice(0, 3)}</span>${h.text}</p>`
      ).join('') + `</div></details>`;

    return html;
  }

  private renderBonds(a: Agent): string {
    const link = (o: Agent) => `<span class="agent-link" data-agent-id="${o.id}">${o.name}</span>${o.alive ? '' : ' <span class="muted">(dead)</span>'}`;
    const byId = (id: number) => this.sim.agents.find((x) => x.id === id);
    const parts: string[] = [];

    const mother = a.motherId !== null ? byId(a.motherId) : undefined;
    const father = a.fatherId !== null ? byId(a.fatherId) : undefined;
    if (mother || father) {
      const ps = [father, mother].filter((p): p is Agent => !!p).map(link);
      parts.push(`Child of ${ps.join(' and ')}.`);
    }

    const spouse = a.spouseId !== null ? byId(a.spouseId) : undefined;
    if (spouse) {
      parts.push(spouse.alive
        ? `Married to ${link(spouse)}.`
        : `<span class="muted">Widowed —</span> was married to ${link(spouse)}.`);
    }
    const children = a.childIds.map(byId).filter((o): o is Agent => !!o);
    if (children.length) parts.push(`Children: ${children.map(link).join(', ')}.`);

    const friends = a.friendIds.map(byId).filter((o): o is Agent => !!o);
    if (friends.length) parts.push(`Friends: ${friends.map(link).join(', ')}.`);
    const rivals = a.rivalIds.map(byId).filter((o): o is Agent => !!o);
    if (rivals.length) parts.push(`Rivals: ${rivals.map(link).join(', ')}.`);
    const grudges = a.grudgeIds.map(byId).filter((o): o is Agent => !!o);
    for (const g of grudges) {
      parts.push(`<span class="bad">Has sworn a blood-oath against ${link(g)} of ${this.sim.factions[g.factionId].name}.</span>`);
    }
    if (parts.length === 0) return `<p class="muted">Keeps to themselves.</p>`;
    return `<p>${parts.join('<br>')}</p>`;
  }

  private taskText(a: Agent): string {
    const t = a.task!;
    switch (t.kind) {
      case 'gather': return `gathering ${t.resource} at (${t.x},${t.y})`;
      case 'deposit': return `hauling goods back to the hall`;
      case 'build': return `working on a construction site`;
      case 'raid': return `marching to war`;
      case 'patrol': return `standing watch`;
      case 'eat': return `looking for a meal`;
      case 'wander': return `wandering`;
      case 'flee': return `fleeing from battle`;
      case 'craft': return `at work in the workshop`;
      case 'trade': return `leading a caravan`;
      case 'heal': return `tending the sick`;
    }
  }

  // ---------------- factions ----------------

  private renderFactions(): string {
    let html = '';
    const live = this.sim.factions;
    const focus = this.selectedFactionId;

    for (const f of live) {
      const pop = this.sim.factionPop(f.id);
      const leader = this.sim.agents.find((x) => x.id === f.leaderId);
      const isFocus = focus === f.id;
      html += `<h2 style="color:${f.color}">${f.symbol} ${f.name}${f.alive ? '' : ' <span class="bad">(destroyed)</span>'}</h2>`;
      html += `<p class="muted">seat: ${f.settlement} · ${f.government} · wars won ${f.warsWon} / lost ${f.warsLost}</p>`;
      html += `<p>Population ${pop}. Led by ${leader
        ? `<span class="agent-link" data-agent-id="${leader.id}">${leader.name}</span>, ${f.leaderTitle}`
        : '<span class="muted">no one — the seat is empty</span>'}.</p>`;
      if (isFocus || live.filter((x) => x.alive).length <= 3) {
        html += `<p><em>${f.myth}</em></p>`;
        html += `<p>They ${f.ethos}.</p>`;
        const members = this.sim.membersOf(f.id);
        const roles = ['worker', 'builder', 'crafter', 'medic', 'soldier', 'child'] as const;
        const counts = roles.map((r) => `${members.filter((m) => m.role === r).length} ${r}${r === 'child' ? 'ren' : 's'}`).join(', ');
        html += `<p class="muted">${counts}</p>`;
        const notables = members
          .map((a) => ({ a, fame: this.fame(a) }))
          .sort((x, y) => y.fame - x.fame)
          .slice(0, 5)
          .filter((x) => x.fame > 0);
        if (notables.length) {
          html += `<p>Notables: ${notables.map(({ a }) =>
            `<span class="agent-link" data-agent-id="${a.id}">${a.name}</span> <em class="muted">${this.epithet(a)}</em>`
          ).join(' · ')}</p>`;
        }
      } else {
        html += `<p class="muted"><span class="fac-name" data-faction-id="${f.id}">lore & details…</span></p>`;
      }
      html += `<p>Stock: food ${Math.floor(f.stock.food)}, wood ${f.stock.wood}, stone ${f.stock.stone}, metal ${f.stock.metal}</p>`;

      if (f.research.done.length > 0 || f.research.branch) {
        const branchName = f.research.branch === 'war' ? 'the arts of war'
          : f.research.branch === 'trade' ? 'commerce' : f.research.branch === 'science' ? 'natural philosophy' : '—';
        html += `<p><span class="muted">Knowledge:</span> ${f.research.done.length ? f.research.done.join(', ') : 'none yet'}`;
        if (f.alive && f.research.branch) html += ` <span class="muted">· pursuing ${branchName}</span>`;
        html += `</p>`;
      }

      if (f.popHistory.length > 1) {
        const blocks = '▁▂▃▄▅▆▇█';
        const hist = f.popHistory.slice(-40);
        const max = Math.max(...hist, 1);
        const spark = hist.map((v) => blocks[Math.min(7, Math.floor((v / max) * 7.99))]).join('');
        html += `<p class="muted">souls over time: <span class="good">${spark}</span> (peak ${max})</p>`;
      }

      const rels: string[] = [];
      for (const o of live) {
        if (o.id === f.id || !o.alive || !f.alive) continue;
        const war = this.sim.wars.find((w) => (w.a === f.id && w.b === o.id) || (w.b === f.id && w.a === o.id));
        if (war) {
          rels.push(`<span class="rel-war">fighting ${war.name} against ${o.name}</span>`);
        } else {
          const r = relationLabel(f.relations[o.id] ?? 0);
          rels.push(`<span class="${r.cls}">${r.label}</span> with <span class="fac-name" data-faction-id="${o.id}" style="color:${o.color}">${o.name}</span>`);
        }
      }
      if (rels.length) html += `<p>${rels.join(' · ')}</p>`;
      html += `<hr style="border:none;border-top:1px solid #2a2a38;margin:10px 0">`;
    }
    return html;
  }

  private exportChronicle() {
    const lines: string[] = [`THE CHRONICLE OF THE WORLD`, `as of ${this.sim.dateString()}`, ''];
    for (const c of [...this.sim.chronicle].reverse()) {
      lines.push(`Year ${c.year}, ${seasonName(c.season)} — ${c.text}`);
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

    let html = `<h2>Figures of Legend</h2>`;
    if (figures.length === 0) {
      html += `<p class="muted">No one has yet done anything worth a song.</p>`;
    } else {
      html += `<div class="hist">` + figures.map(({ a, fame }) => {
        const f = this.sim.factions[a.factionId];
        const status = a.alive ? '' : ' <span class="muted">†</span>';
        return `<p><span style="color:${f.color}">${f.symbol}</span> ${link(a)} <em>${this.epithet(a)}</em>${status}
          <span class="muted">— ${a.kills} kills, ${a.built} raised, ${a.crafted} forged (renown ${fame})</span></p>`;
      }).join('') + `</div>`;
    }

    // named artifacts and where they are now
    const artifacts: { label: string; holder: Agent }[] = [];
    for (const a of this.sim.agents) {
      for (const i of a.equipment) {
        if (i.artifactName) artifacts.push({ label: itemLabel(i), holder: a });
      }
    }
    html += `<h3>Named works</h3>`;
    if (artifacts.length === 0) {
      html += `<p class="muted">No masterworks have been forged yet.</p>`;
    } else {
      html += `<ul>` + artifacts.slice(0, 20).map(({ label, holder }) => {
        const f = this.sim.factions[holder.factionId];
        return `<li>${label} — ${holder.alive
          ? `borne by ${link(holder)} of <span style="color:${f.color}">${f.name}</span>`
          : `<span class="muted">lost with the body of ${link(holder)}</span>`}</li>`;
      }).join('') + `</ul>`;
    }
    return html;
  }

  // ---------------- chronicle ----------------

  private renderChronicle(): string {
    if (this.sim.chronicle.length === 0) return `<p class="muted">Nothing of note has happened yet.</p>`;
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
    let html = `<h2>Chronicle of the World</h2>`;
    html += `<div class="filters">${btn('all', 'All')}${btn('war', '⚔ Wars')}${btn('politics', 'Politics')}${btn('people', 'People')}${btn('deaths', 'Deaths')}${btn('building', 'Works')}<button class="tab chron-filter" data-export title="download the chronicle as text">⤓ Export</button></div>`;
    html += entries.length === 0
      ? `<p class="muted">Nothing of that kind has happened yet.</p>`
      : `<div class="hist">` + entries.map((c) =>
          `<p><span class="yr">Y${c.year} ${seasonName(c.season).slice(0, 3)}</span><span class="${cls[c.kind] ?? ''}">${c.text}</span></p>`
        ).join('') + `</div>`;
    return html;
  }
}
