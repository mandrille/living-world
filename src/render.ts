import { Sim } from './sim';
import { W, H } from './world';
import { Agent, TerrainType } from './types';

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
      const sx = b.x * s - ox + s / 2;
      const sy = b.y * s - oy + s / 2;
      if (sx < -s || sy < -s || sx > this.canvas.width + s || sy > this.canvas.height + s) continue;
      c.fillText('w', sx, sy + 1);
    }

    // the living (children drawn smaller, in a second pass)
    const children: Agent[] = [];
    c.font = `bold ${Math.ceil(s) + 1}px Consolas, monospace`;
    for (const a of this.sim.agents) {
      if (!a.alive) continue;
      const sx = a.x * s - ox + s / 2;
      const sy = a.y * s - oy + s / 2;
      if (sx < -s || sy < -s || sx > this.canvas.width + s || sy > this.canvas.height + s) continue;
      if (a.role === 'child') { children.push(a); continue; }
      const f = this.sim.factions[a.factionId];
      const glyph = a.role === 'leader' ? 'Ω' : a.role === 'soldier' ? '†' : '@';
      c.fillStyle = f.color;
      c.fillText(glyph, sx, sy + 1);
    }
    if (children.length) {
      c.font = `bold ${Math.max(6, Math.ceil(s * 0.65))}px Consolas, monospace`;
      for (const a of children) {
        c.fillStyle = this.sim.factions[a.factionId].color;
        c.fillText('@', a.x * s - ox + s / 2, a.y * s - oy + s / 2 + 1);
      }
    }

    // selection ring
    if (this.sim.selectedAgentId !== null) {
      const a = this.sim.agents.find((x) => x.id === this.sim.selectedAgentId);
      if (a && a.alive) {
        c.strokeStyle = '#ffffff';
        c.lineWidth = 1.5;
        c.strokeRect(a.x * s - ox - 1, a.y * s - oy - 1, s + 2, s + 2);
      }
    } else if (this.sim.selectedTile) {
      const st = this.sim.selectedTile;
      c.strokeStyle = '#e8d9a0';
      c.lineWidth = 1.5;
      c.strokeRect(st.x * s - ox, st.y * s - oy, s, s);
    }

    this.drawHoverLabel(ox, oy, s);
    this.drawMinimap(ox, oy, s);
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
        target = { name: a.name, sub: `${a.role} of ${f.name}`, color: f.color, x: a.x, y: a.y };
      }
    }
    if (!target) {
      for (const corpse of this.sim.corpses) {
        if (Math.max(Math.abs(corpse.x - this.hoverX), Math.abs(corpse.y - this.hoverY)) <= 1) {
          const a = this.sim.agentById(corpse.agentId);
          if (a) {
            target = { name: a.name, sub: 'dead — click to read their story', color: '#8a8a99', x: corpse.x, y: corpse.y };
            break;
          }
        }
      }
    }
    if (!target) {
      for (const b of this.sim.beasts) {
        if (Math.max(Math.abs(b.x - this.hoverX), Math.abs(b.y - this.hoverY)) <= 1) {
          target = { name: 'a wolf', sub: 'lean and patient — keeps to the deep woods', color: '#9a8f8f', x: b.x, y: b.y };
          break;
        }
      }
    }
    if (!target) {
      const b = this.sim.buildingAt(this.hoverX, this.hoverY);
      if (b) {
        const f = this.sim.factions[b.factionId];
        target = { name: b.complete ? b.name : `${b.name} (under construction)`, sub: f.name, color: f.color, x: b.x, y: b.y };
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
