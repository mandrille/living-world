import { Sim } from './sim';
import { W, H } from './world';
import { Agent, TerrainType } from './types';
import { t, tg, tr } from './i18n';

export const TILE = 10;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const TERRAIN_GLYPH: Record<TerrainType, { ch: string; color: string }> = {
  grass:    { ch: '.', color: '#3f5a3a' },
  forest:   { ch: '♠', color: '#2f7a3a' },
  mountain: { ch: '▲', color: '#8a8a92' },
  ore:      { ch: '*', color: '#d8b25f' },
  water:    { ch: '≈', color: '#3f6fae' },
  farmland: { ch: '≡', color: '#a8973f' },
  crater:   { ch: '∴', color: '#7a8f5f' },
};

const BUILDING_GLYPH: Record<string, string> = {
  hall: '◆', house: '⌂', farm: '▦', barracks: '✠', workshop: '⚒', hamlet: '◇',
};

export class Renderer {
  zoom = 1;
  cx = W / 2; // camera center, in tile units
  cy = H / 2;
  hoverX = -1;
  hoverY = -1;
  dirty = true; // redraw only when the world or camera changed
  onTileClick: ((tx: number, ty: number) => void) | null = null;

  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private builtZoom = 0; // zoom the terrain cache was rendered at
  private minimap: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private minibase: HTMLCanvasElement;
  private lastMinimapDraw = 0;
  // cosmetic life: hearth smoke and swaying figures (never touches the seeded rng)
  private particles: { x: number; y: number; vx: number; vy: number; life: number; max: number }[] = [];
  private lastFrameTime = performance.now();

  constructor(private canvas: HTMLCanvasElement, private sim: Sim) {
    this.ctx = canvas.getContext('2d')!;
    this.terrain = document.createElement('canvas');
    this.tctx = this.terrain.getContext('2d')!;
    this.minimap = document.getElementById('minimap') as HTMLCanvasElement;
    this.mctx = this.minimap.getContext('2d')!;
    this.minibase = document.createElement('canvas');
    this.minibase.width = this.minimap.width;
    this.minibase.height = this.minimap.height;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.bindMinimap();
  }

  private bindMinimap() {
    const jump = (e: MouseEvent) => {
      const rect = this.minimap.getBoundingClientRect();
      this.cx = ((e.clientX - rect.left) / rect.width) * W;
      this.cy = ((e.clientY - rect.top) / rect.height) * H;
      this.dirty = true;
      this.lastMinimapDraw = 0;
    };
    let down = false;
    this.minimap.addEventListener('mousedown', (e) => { down = true; jump(e); e.stopPropagation(); });
    this.minimap.addEventListener('mousemove', (e) => { if (down) jump(e); });
    window.addEventListener('mouseup', () => { down = false; });
  }

  private resize() {
    const wrap = this.canvas.parentElement!;
    this.canvas.width = Math.max(200, wrap.clientWidth);
    this.canvas.height = Math.max(200, wrap.clientHeight);
    this.dirty = true;
  }

  /** pixels per tile at the current zoom */
  private get s(): number {
    return TILE * this.zoom;
  }

  /** top-left of the view in zoomed pixel space, clamped to the map */
  private view() {
    const s = this.s;
    let ox = this.cx * s - this.canvas.width / 2;
    let oy = this.cy * s - this.canvas.height / 2;
    const maxOx = W * s - this.canvas.width;
    const maxOy = H * s - this.canvas.height;
    ox = maxOx <= 0 ? maxOx / 2 : Math.max(0, Math.min(maxOx, ox));
    oy = maxOy <= 0 ? maxOy / 2 : Math.max(0, Math.min(maxOy, oy));
    return { ox, oy, s };
  }

  screenToTile(px: number, py: number): { tx: number; ty: number } {
    const { ox, oy, s } = this.view();
    return { tx: Math.floor((px + ox) / s), ty: Math.floor((py + oy) / s) };
  }

  zoomAt(factor: number, px: number, py: number) {
    const { ox, oy, s } = this.view();
    const wx = (px + ox) / s;
    const wy = (py + oy) / s;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const s2 = this.s;
    this.cx = wx - (px - this.canvas.width / 2) / s2;
    this.cy = wy - (py - this.canvas.height / 2) / s2;
    this.dirty = true;
  }

  zoomCenter(factor: number) {
    this.zoomAt(factor, this.canvas.width / 2, this.canvas.height / 2);
  }

  private bindInput() {
    const c = this.canvas;
    let panning = false;
    let dragged = false;
    let lastX = 0;
    let lastY = 0;

    c.addEventListener('mousedown', (e) => {
      panning = true;
      dragged = false;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      const t = this.screenToTile(e.clientX - rect.left, e.clientY - rect.top);
      // beyond the map's edge there is nothing to hover
      if (t.tx < 0 || t.ty < 0 || t.tx >= W || t.ty >= H) { t.tx = -1; t.ty = -1; }
      if (t.tx !== this.hoverX || t.ty !== this.hoverY) {
        this.hoverX = t.tx;
        this.hoverY = t.ty;
        this.dirty = true;
      }
      if (!panning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (!dragged && Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      if (dragged) {
        this.cx -= dx / this.s;
        this.cy -= dy / this.s;
        this.cx = Math.max(0, Math.min(W, this.cx));
        this.cy = Math.max(0, Math.min(H, this.cy));
        lastX = e.clientX;
        lastY = e.clientY;
        c.style.cursor = 'grabbing';
        this.dirty = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (panning && !dragged && e.target === c) {
        const rect = c.getBoundingClientRect();
        const t = this.screenToTile(e.clientX - rect.left, e.clientY - rect.top);
        this.onTileClick?.(t.tx, t.ty);
        this.dirty = true;
      }
      panning = false;
      dragged = false;
      c.style.cursor = 'crosshair';
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * 0.0012), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    c.addEventListener('mouseleave', () => {
      this.hoverX = -1;
      this.hoverY = -1;
      this.dirty = true;
    });

    // ---- touch: one finger pans (or taps to select), two fingers pinch-zoom ----
    let tPanning = false;
    let tDragged = false;
    let tLastX = 0;
    let tLastY = 0;
    let pinchDist = 0;
    const dist2 = (ts: TouchList) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);

    c.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        tPanning = true;
        tDragged = false;
        tLastX = e.touches[0].clientX;
        tLastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        tPanning = false;
        pinchDist = dist2(e.touches);
      }
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && tPanning) {
        const dx = e.touches[0].clientX - tLastX;
        const dy = e.touches[0].clientY - tLastY;
        if (!tDragged && Math.abs(dx) + Math.abs(dy) > 8) tDragged = true;
        if (tDragged) {
          this.cx = Math.max(0, Math.min(W, this.cx - dx / this.s));
          this.cy = Math.max(0, Math.min(H, this.cy - dy / this.s));
          tLastX = e.touches[0].clientX;
          tLastY = e.touches[0].clientY;
          this.dirty = true;
        }
      } else if (e.touches.length === 2 && pinchDist > 0) {
        const nd = dist2(e.touches);
        const rect = c.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        this.zoomAt(nd / pinchDist, mx, my);
        pinchDist = nd;
      }
    }, { passive: false });

    c.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (tPanning && !tDragged && e.changedTouches.length === 1) {
        const rect = c.getBoundingClientRect();
        const t = this.screenToTile(e.changedTouches[0].clientX - rect.left, e.changedTouches[0].clientY - rect.top);
        this.onTileClick?.(t.tx, t.ty);
        this.dirty = true;
      }
      tPanning = false;
      tDragged = false;
      if (e.touches.length < 2) pinchDist = 0;
    }, { passive: false });
  }

  // the land itself changes with the seasons: spring, summer, autumn, winter
  private static GRASS_SEASON = ['#3f5a3a', '#47633f', '#5c5638', '#535861'];
  private static FOREST_SEASON = ['#2f7a3a', '#2f8a3a', '#8a6f2f', '#3f6a55'];
  private static FARM_SEASON = ['#a8973f', '#b0a03f', '#8a7a35', '#6a6350'];

  private redrawTerrain() {
    const s = this.s;
    this.terrain.width = Math.ceil(W * s);
    this.terrain.height = Math.ceil(H * s);
    const c = this.tctx;
    const season = this.sim.season;
    const seasonColor: Partial<Record<TerrainType, string>> = {
      grass: Renderer.GRASS_SEASON[season],
      forest: Renderer.FOREST_SEASON[season],
      farmland: Renderer.FARM_SEASON[season],
    };
    c.fillStyle = '#05050a';
    c.fillRect(0, 0, this.terrain.width, this.terrain.height);
    const glyphs = s >= 7; // too small to read: fall back to color blocks
    c.font = `${Math.ceil(s) + 1}px Consolas, monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = this.sim.tiles[y * W + x];
        let g = TERRAIN_GLYPH[t.terrain];
        const sc = seasonColor[t.terrain];
        if (sc) g = { ch: g.ch, color: sc };
        if (t.terrain === 'grass' && (t.wear ?? 0) > 90) {
          g = { ch: '∙', color: '#7a6a4f' }; // a well-trodden path
        }
        if (t.terrain === 'water') {
          c.fillStyle = '#0a1626';
          c.fillRect(x * s, y * s, s + 1, s + 1);
        }
        if (glyphs) {
          c.fillStyle = g.color;
          c.fillText(g.ch, x * s + s / 2, y * s + s / 2 + 1);
        } else if (t.terrain !== 'grass') {
          c.fillStyle = g.color;
          c.globalAlpha = 0.7;
          c.fillRect(x * s, y * s, s + 1, s + 1);
          c.globalAlpha = 1;
        }
      }
    }

    for (const b of this.sim.buildings) {
      const f = this.sim.factions[b.factionId];
      c.fillStyle = '#0b0b10';
      c.fillRect(b.x * s, b.y * s, s, s);
      c.fillStyle = b.complete ? f.color : '#55555f';
      if (glyphs) {
        c.font = `bold ${Math.ceil(s) + 2}px Consolas, monospace`;
        c.fillText(BUILDING_GLYPH[b.type] ?? '?', b.x * s + s / 2, b.y * s + s / 2 + 1);
        c.font = `${Math.ceil(s) + 1}px Consolas, monospace`;
      } else {
        c.fillRect(b.x * s, b.y * s, s + 1, s + 1);
      }
    }
    this.builtZoom = this.zoom;
    this.sim.terrainDirty = false;
  }

  draw() {
    if (!this.dirty && !this.sim.terrainDirty) return;
    this.dirty = false;
    if (this.sim.terrainDirty || this.builtZoom !== this.zoom) this.redrawTerrain();
    const c = this.ctx;
    const { ox, oy, s } = this.view();
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    c.fillStyle = '#05050a';
    c.fillRect(0, 0, cw, ch);
    // blit only the visible window of the terrain cache
    const sx = Math.max(0, ox), sy = Math.max(0, oy);
    const dx = sx - ox, dy = sy - oy;
    const bw = Math.min(this.terrain.width - sx, cw - dx);
    const bh = Math.min(this.terrain.height - sy, ch - dy);
    if (bw > 0 && bh > 0) c.drawImage(this.terrain, sx, sy, bw, bh, dx, dy, bw, bh);

    c.textAlign = 'center';
    c.textBaseline = 'middle';

    // the fallen
    c.font = `${Math.ceil(s)}px Consolas, monospace`;
    c.fillStyle = '#6a6a72';
    for (const corpse of this.sim.corpses) {
      const sx = corpse.x * s - ox + s / 2;
      const sy = corpse.y * s - oy + s / 2;
      if (sx < -s || sy < -s || sx > this.canvas.width + s || sy > this.canvas.height + s) continue;
      c.fillText('☠', sx, sy + 1);
    }

    // wolves
    c.font = `${Math.ceil(s)}px Consolas, monospace`;
    c.fillStyle = '#9a8f8f';
    for (const b of this.sim.beasts) {
      const p = this.smoothPos(-b.id, b.x, b.y, now);
      const sx = p.x * s - ox + s / 2;
      const sy = p.y * s - oy + s / 2;
      if (sx < -s || sy < -s || sx > this.canvas.width + s || sy > this.canvas.height + s) continue;
      c.fillText('w', sx + Math.sin(now / 1100 + b.id * 2.1) * s * 0.05, sy + 1);
    }

    // the living (children drawn smaller, in a second pass)
    const children: Agent[] = [];
    c.font = `bold ${Math.ceil(s) + 1}px Consolas, monospace`;
    for (const a of this.sim.agents) {
      if (!a.alive) continue;
      const p = this.smoothPos(a.id, a.x, a.y, now);
      const sx = p.x * s - ox + s / 2;
      const sy = p.y * s - oy + s / 2;
      if (sx < -s || sy < -s || sx > this.canvas.width + s || sy > this.canvas.height + s) continue;
      if (a.role === 'child') { children.push(a); continue; }
      const f = this.sim.factions[a.factionId];
      const glyph = a.role === 'leader' ? 'Ω' : a.role === 'soldier' ? '†' : '@';
      c.fillStyle = f.color;
      // a gentle sway keeps the crowd looking alive between world-steps
      c.fillText(glyph,
        sx + Math.sin(now / 1400 + a.id * 0.9) * s * 0.04,
        sy + 1 + Math.sin(now / 900 + a.id * 1.7) * s * 0.05);
    }
    if (children.length) {
      c.font = `bold ${Math.max(6, Math.ceil(s * 0.65))}px Consolas, monospace`;
      for (const a of children) {
        c.fillStyle = this.sim.factions[a.factionId].color;
        const p = this.smoothPos(a.id, a.x, a.y, now);
        // children fidget more than their elders
        c.fillText('@',
          p.x * s - ox + s / 2 + Math.sin(now / 450 + a.id) * s * 0.08,
          p.y * s - oy + s / 2 + 1 + Math.sin(now / 550 + a.id * 1.3) * s * 0.06);
      }
    }

    // selection ring
    if (this.sim.selectedAgentId !== null) {
      const a = this.sim.agents.find((x) => x.id === this.sim.selectedAgentId);
      if (a && a.alive) {
        const p = this.smoothPos(a.id, a.x, a.y, now);
        c.strokeStyle = '#ffffff';
        c.lineWidth = 1.5;
        c.strokeRect(p.x * s - ox - 1, p.y * s - oy - 1, s + 2, s + 2);
      }
    } else if (this.sim.selectedTile) {
      const st = this.sim.selectedTile;
      c.strokeStyle = '#e8d9a0';
      c.lineWidth = 1.5;
      c.strokeRect(st.x * s - ox, st.y * s - oy, s, s);
    }

    this.drawSmoke(ox, oy, s, now, dt);
    this.drawHoverLabel(ox, oy, s);
    this.drawMinimap(ox, oy, s);
  }

  /** hearth smoke rising from lived-in roofs; purely cosmetic */
  private drawSmoke(ox: number, oy: number, s: number, now: number, dt: number) {
    const c = this.ctx;
    if (this.particles.length < 140) {
      for (const b of this.sim.buildings) {
        if (!b.complete) continue;
        if (b.type !== 'hall' && b.type !== 'hamlet' && b.type !== 'house' && b.type !== 'workshop') continue;
        const sx = b.x * s - ox;
        const sy = b.y * s - oy;
        if (sx < -s || sy < -s || sx > this.canvas.width + s || sy > this.canvas.height + s) continue;
        if (Math.random() < dt * (b.type === 'workshop' ? 0.9 : 0.3)) {
          this.particles.push({
            x: b.x + 0.35 + Math.random() * 0.3,
            y: b.y + 0.1,
            vx: (Math.random() - 0.5) * 0.04,
            vy: -0.22 - Math.random() * 0.12,
            life: 0,
            max: 3.5 + Math.random() * 2.5,
          });
        }
      }
    }
    const wind = Math.sin(now / 6000) * 0.06;
    c.save();
    c.fillStyle = '#a8a8b2';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += (p.vx + wind) * dt;
      p.y += p.vy * dt;
      const px = p.x * s - ox;
      const py = p.y * s - oy;
      if (px < -12 || py < -12 || px > this.canvas.width + 12) { this.particles.splice(i, 1); continue; }
      const t01 = p.life / p.max;
      c.globalAlpha = 0.32 * (1 - t01);
      const sz = Math.max(1.5, s * (0.10 + t01 * 0.14));
      c.fillRect(px - sz / 2, py - sz / 2, sz, sz);
    }
    c.restore();
  }

  private drawMinimap(ox: number, oy: number, s: number) {
    const mw = this.minimap.width;
    const mh = this.minimap.height;
    const kx = mw / W;
    const ky = mh / H;

    // rebuild the terrain+population base at most twice a second
    const now = performance.now();
    if (now - this.lastMinimapDraw > 500) {
      this.lastMinimapDraw = now;
      const b = this.minibase.getContext('2d')!;
      b.fillStyle = '#05050a';
      b.fillRect(0, 0, mw, mh);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = this.sim.tiles[y * W + x];
          if (t.terrain === 'grass') continue;
          b.fillStyle = TERRAIN_GLYPH[t.terrain].color;
          b.globalAlpha = t.terrain === 'water' ? 0.55 : 0.4;
          b.fillRect(x * kx, y * ky, kx + 0.5, ky + 0.5);
        }
      }
      b.globalAlpha = 1;
      for (const bd of this.sim.buildings) {
        b.fillStyle = this.sim.factions[bd.factionId].color;
        b.fillRect(bd.x * kx - 1, bd.y * ky - 1, kx + 2, ky + 2);
      }
      for (const a of this.sim.agents) {
        if (!a.alive) continue;
        b.fillStyle = this.sim.factions[a.factionId].color;
        b.fillRect(a.x * kx, a.y * ky, Math.max(1, kx), Math.max(1, ky));
      }
    }

    const m = this.mctx;
    m.drawImage(this.minibase, 0, 0);
    // viewport rectangle
    const rx = (ox / s) * kx;
    const ry = (oy / s) * ky;
    const rw = (this.canvas.width / s) * kx;
    const rh = (this.canvas.height / s) * ky;
    m.strokeStyle = '#ffffff';
    m.lineWidth = 1;
    m.strokeRect(rx + 0.5, ry + 0.5, Math.min(rw, mw - 1), Math.min(rh, mh - 1));
  }

  // ---- movement smoothing: glyphs glide between tiles instead of snapping ----
  private anim = new Map<number, { fx: number; fy: number; tx: number; ty: number; start: number }>();
  private static readonly GLIDE_MS = 420;

  private smoothPos(key: number, x: number, y: number, now: number): { x: number; y: number } {
    if (this.anim.size > 6000) this.anim.clear(); // long-dead ids accumulate; a rare clear only costs one frame of glide
    let a = this.anim.get(key);
    if (!a) {
      a = { fx: x, fy: y, tx: x, ty: y, start: 0 };
      this.anim.set(key, a);
    }
    if (a.tx !== x || a.ty !== y) {
      // start the new glide from wherever the glyph is drawn right now
      const p = Math.min(1, (now - a.start) / Renderer.GLIDE_MS);
      a.fx = a.fx + (a.tx - a.fx) * p;
      a.fy = a.fy + (a.ty - a.fy) * p;
      if (Math.abs(x - a.tx) > 3 || Math.abs(y - a.ty) > 3) {
        // catch-up bursts move people many tiles at once — just snap
        a.fx = x;
        a.fy = y;
      }
      a.tx = x;
      a.ty = y;
      a.start = now;
    }
    const p = Math.min(1, (now - a.start) / Renderer.GLIDE_MS);
    return { x: a.fx + (a.tx - a.fx) * p, y: a.fy + (a.ty - a.fy) * p };
  }

  private drawHoverLabel(ox: number, oy: number, s: number) {
    if (this.hoverX < 0) return;
    let target: { name: string; sub: string; color: string; x: number; y: number } | null = null;

    let bestD = Infinity;
    for (const a of this.sim.agents) {
      if (!a.alive) continue;
      const d = Math.max(Math.abs(a.x - this.hoverX), Math.abs(a.y - this.hoverY));
      if (d <= 1 && d < bestD) {
        bestD = d;
        const f = this.sim.factions[a.factionId];
        target = { name: a.name, sub: t('{r} of {f}', { r: tg(a.role, a.sex), f: f.name }), color: f.color, x: a.x, y: a.y };
      }
    }
    if (!target) {
      for (const corpse of this.sim.corpses) {
        if (Math.max(Math.abs(corpse.x - this.hoverX), Math.abs(corpse.y - this.hoverY)) <= 1) {
          const a = this.sim.agentById(corpse.agentId);
          if (a) {
            target = { name: a.name, sub: t('dead — click to read their story'), color: '#8a8a99', x: corpse.x, y: corpse.y };
            break;
          }
        }
      }
    }
    if (!target) {
      for (const b of this.sim.beasts) {
        if (Math.max(Math.abs(b.x - this.hoverX), Math.abs(b.y - this.hoverY)) <= 1) {
          target = { name: t('a wolf'), sub: t('lean and patient — keeps to the deep woods'), color: '#9a8f8f', x: b.x, y: b.y };
          break;
        }
      }
    }
    if (!target) {
      const b = this.sim.buildingAt(this.hoverX, this.hoverY);
      if (b) {
        const f = this.sim.factions[b.factionId];
        target = { name: b.complete ? tr(b.name) : t('{b} (under construction)', { b: tr(b.name) }), sub: f.name, color: f.color, x: b.x, y: b.y };
      }
    }
    if (!target) return;

    const c = this.ctx;
    c.font = '12px Consolas, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    const line1 = target.name;
    const line2 = target.sub;
    const w = Math.max(c.measureText(line1).width, c.measureText(line2).width) + 12;
    let lx = target.x * s - ox + s + 6;
    let ly = target.y * s - oy - 4;
    if (lx + w > this.canvas.width) lx = target.x * s - ox - w - 6;
    if (ly < 0) ly = 0;
    if (ly + 34 > this.canvas.height) ly = this.canvas.height - 34;
    c.fillStyle = 'rgba(16,16,24,0.92)';
    c.fillRect(lx, ly, w, 32);
    c.strokeStyle = target.color;
    c.lineWidth = 1;
    c.strokeRect(lx + 0.5, ly + 0.5, w - 1, 31);
    c.fillStyle = '#ffffff';
    c.fillText(line1, lx + 6, ly + 4);
    c.fillStyle = '#8a8a99';
    c.fillText(line2, lx + 6, ly + 18);
  }
}
