// 信号フィールド（procedural）— ブラウザ「景色」ビュー
//
// モデル:
//   骨格   : 検索網（直線の枝＋点滅ボックス）が伸びて新しいコロニー中心を配る。
//   主役   : 各中心から「円形コロニー」が育つ。放射繊維テクスチャ＋明るい縁の円が
//            広がり、重なり合って画面を満たしていく（teamLab の花のように）。
//   被覆   : 密度はゆっくり減衰（触れている間）。個々の死滅・明滅は局所の揺らぎで、
//            全体被覆は arc とともに増加 → full で全面の「生きた面」へ。
//   うねり : 背景ではなく場そのものに外乱波を走らせる。ジェスチャ＝波紋（水面に物を
//            落とす）、ランダムな突風、セクション到来＝大きな風。密度サンプルを変位・変調。
//
// 配置: note の初出時に best-candidate 散布（ランダム候補から既存コロニー最遠を選ぶ）
//       → 2〜4 タッチでも画面全体に散る。同じ note は同じ場所（セッション内）。
//
// 状態は engine.getVisualState() を購読（音と同じ core 状態）。

export type VisualState = {
  held: number[]
  echoes: { id: number; kind: string; notes: number[]; level: number }[]
  gesture: { kind: string; notes: number[]; id: number } | null
  development: number
  arc: number
  arc3: number
  stage: number
  tide: number
  brightness: number
  shimmer: number
  breadth: number
}

const DCELL = 6
const GCELL = 15
const TAU = Math.PI * 2
const RAMP = [' ', '.', '·', ':', '+', '*', '#', '@']

type Colony = {
  x: number; y: number
  R: number; maxR: number
  age: number; life: number
  seed: number; fiberFreq: number
  alive: boolean
}
type Node = {
  x: number; y: number; dir: number
  parent: Node | null
  tip: boolean; age: number; life: number
  label: number; blink: number; alive: boolean
}
type Disturb = {
  ripple: boolean
  x: number; y: number; dir: number
  t0: number; speed: number; amp: number; wl: number; ttl: number
}

export class SignalField {
  private colonies: Colony[] = []
  private nodes: Node[] = []
  private disturbs: Disturb[] = []
  private assigned = new Map<number, { x: number; y: number }>() // note → 座席（散布）
  private dens: Float32Array | null = null
  private dw = 0
  private dh = 0
  private t = 0
  private lastGestureId = -1
  private lastStage = 0
  private surge = 0
  private growAcc = 0
  private netEnergy = 0
  private nextGust = 3

  render(ctx: CanvasRenderingContext2D, w: number, h: number, vs: VisualState, dtMs: number) {
    const dt = Math.min(dtMs, 50) / 1000
    this.t += dt
    this.ensureGrid(w, h)

    if (vs.gesture && vs.gesture.id !== this.lastGestureId) {
      this.lastGestureId = vs.gesture.id
      // ジェスチャ＝水面への一滴。波紋を走らせる
      const n = vs.gesture.notes[0] ?? 60
      const p = this.seatOf(n, w, h)
      const amp = vs.gesture.kind === 'overlapping' ? 1.2 : vs.gesture.kind === 'question' ? 0.9 : 0.6
      this.addRipple(p.x, p.y, amp)
    }
    if (vs.stage > this.lastStage) {
      this.surge = 1
      this.addGust(w, h, 1.4) // セクション到来＝大きな風
    }
    this.lastStage = vs.stage
    this.surge *= Math.pow(0.1, dt)

    // ランダムな突風（潮が高いほど頻繁）
    this.nextGust -= dt * (0.7 + 0.8 * vs.tide + 0.5 * vs.shimmer)
    if (this.nextGust <= 0) {
      this.nextGust = 2.5 + Math.random() * 5
      this.addGust(w, h, 0.5 + Math.random() * 0.5)
    }
    this.disturbs = this.disturbs.filter((d) => this.t - d.t0 < d.ttl)

    this.updateNetwork(dt, vs, w, h)
    this.updateColonies(dt, vs, w, h)
    this.feedColonies(dt)
    this.updateDensity(dt, vs)

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    this.drawGrid(ctx, w, h, vs)
    this.drawNature(ctx, w, h, vs)
    this.drawNetwork(ctx)
  }

  // --- 配置（best-candidate 散布。偏り対策）---
  private seatOf(note: number, w: number, h: number): { x: number; y: number } {
    const got = this.assigned.get(note)
    if (got) return got
    const others = [...this.assigned.values(), ...this.colonies.map((c) => ({ x: c.x, y: c.y }))]
    let best = { x: (0.1 + 0.8 * Math.random()) * w, y: (0.12 + 0.74 * Math.random()) * h }
    let bestScore = -1
    for (let k = 0; k < 14; k++) {
      const cand = { x: (0.08 + 0.84 * Math.random()) * w, y: (0.1 + 0.78 * Math.random()) * h }
      const score = others.length
        ? Math.min(...others.map((o) => Math.hypot(o.x - cand.x, o.y - cand.y)))
        : Math.hypot(cand.x - w / 2, cand.y - h / 2) // 最初の1つは中央寄りを避けすぎない程度に自由
      if (score > bestScore) {
        bestScore = score
        best = cand
      }
    }
    this.assigned.set(note, best)
    return best
  }

  private ensureGrid(w: number, h: number) {
    const dw = Math.ceil(w / DCELL)
    const dh = Math.ceil(h / DCELL)
    if (dw !== this.dw || dh !== this.dh || !this.dens) {
      this.dw = dw
      this.dh = dh
      this.dens = new Float32Array(dw * dh)
    }
  }

  private inject(x: number, y: number, amt: number) {
    const i = (x / DCELL) | 0
    const j = (y / DCELL) | 0
    if (i < 0 || j < 0 || i >= this.dw || j >= this.dh) return
    this.dens![j * this.dw + i] += amt
  }

  private densAt(x: number, y: number): number {
    const i = (x / DCELL) | 0
    const j = (y / DCELL) | 0
    if (i < 0 || j < 0 || i >= this.dw || j >= this.dh) return 0
    return this.dens![j * this.dw + i]
  }

  private spawnColony(x: number, y: number, w: number, h: number) {
    if (this.colonies.filter((c) => c.alive).length >= 22) return
    const base = Math.min(w, h)
    this.colonies.push({
      x, y, R: 6,
      maxR: base * (0.1 + 0.14 * Math.random()),
      age: 0,
      life: 16 + Math.random() * 18, // 長寿命（被覆を積み上げる）
      seed: Math.random() * 1000,
      fiberFreq: 10 + (Math.random() * 14 | 0),
      alive: true,
    })
  }

  // --- 検索網（骨格。直線・点滅ボックス）---
  private updateNetwork(dt: number, vs: VisualState, w: number, h: number) {
    const target = vs.held.length ? 1 : 0
    this.netEnergy += (target - this.netEnergy) * (vs.held.length ? 0.05 : 0.012)

    for (const n of vs.held) {
      const p = this.seatOf(n, w, h)
      const near = this.nodes.some((nd) => Math.hypot(nd.x - p.x, nd.y - p.y) < 60)
      if (!near) {
        const arms = 4 + (Math.random() * 3 | 0)
        for (let k = 0; k < arms; k++) {
          const dir = (k / arms) * TAU + Math.random() * 0.4
          this.nodes.push({ x: p.x, y: p.y, dir, parent: null, tip: true, age: 0, life: 7 + Math.random() * 5, label: ((p.x * 7 + p.y * 13) | 0) % 90 + 10, blink: Math.random() * TAU, alive: true })
        }
        this.spawnColony(p.x, p.y, w, h)
      }
    }

    const maxNodes = Math.floor(140 + 320 * vs.arc)
    const STEP = 34
    this.growAcc += dt * (3 + 9 * vs.arc) * (0.25 + this.netEnergy + this.surge)
    let iter = 0
    while (this.growAcc >= 1 && iter < 50) {
      this.growAcc -= 1
      iter++
      for (const tip of this.nodes.filter((n) => n.tip && n.alive)) {
        if (this.nodes.length >= maxNodes) break
        const dir = tip.dir + (Math.random() - 0.5) * 0.5
        const nx = tip.x + Math.cos(dir) * STEP
        const ny = tip.y + Math.sin(dir) * STEP
        tip.tip = false
        if (nx < 8 || ny < 8 || nx > w - 8 || ny > h - 8) continue
        const child: Node = { x: nx, y: ny, dir, parent: tip, tip: true, age: 0, life: 7 + Math.random() * 5, label: ((nx * 7 + ny * 13) | 0) % 90 + 10, blink: Math.random() * TAU, alive: true }
        this.nodes.push(child)
        // 網の到達点に新しいコロニーが芽吹く（場を配る）
        if (Math.random() < 0.1) this.spawnColony(nx, ny, w, h)
        if (Math.random() < 0.28 && this.nodes.length < maxNodes) {
          const d2 = dir + (Math.random() < 0.5 ? 0.9 : -0.9)
          this.nodes.push({ x: tip.x + Math.cos(d2) * STEP, y: tip.y + Math.sin(d2) * STEP, dir: d2, parent: tip, tip: true, age: 0, life: 7 + Math.random() * 5, label: ((tip.x * 13 + tip.y * 7) | 0) % 90 + 10, blink: Math.random() * TAU, alive: true })
        }
      }
    }

    for (const n of this.nodes) {
      n.age += dt
      if (n.age > n.life || this.netEnergy < 0.02) n.alive = false
    }
    this.nodes = this.nodes.filter((n) => n.alive)
    if (this.nodes.length > maxNodes) this.nodes.splice(0, this.nodes.length - maxNodes)
  }

  // --- 円形コロニーの成長・死滅・再生 ---
  private updateColonies(dt: number, vs: VisualState, w: number, h: number) {
    const grow = (26 + 40 * vs.arc) * (0.5 + this.netEnergy + this.surge)
    for (const c of this.colonies) {
      if (!c.alive) continue
      c.age += dt
      c.R = Math.min(c.maxR * (0.5 + 0.5 * vs.arc + 0.3 * vs.arc3), c.R + grow * dt)
      if (c.age > c.life) {
        c.alive = false
        // 死滅 → 近くで再生（チャーン。全体は広がり続ける）
        if (this.netEnergy > 0.05) {
          const a = Math.random() * TAU
          const d = 90 + Math.random() * 200
          const nx = Math.min(w - 20, Math.max(20, c.x + Math.cos(a) * d))
          const ny = Math.min(h - 20, Math.max(20, c.y + Math.sin(a) * d))
          this.spawnColony(nx, ny, w, h)
        }
      }
    }
    this.colonies = this.colonies.filter((c) => c.alive || c.age < c.life + 2)
  }

  // 円形コロニー: 拡大する縁（リング）に放射繊維パターンで注入 → 円盤が育つ
  private feedColonies(dt: number) {
    for (const c of this.colonies) {
      if (!c.alive) continue
      const steps = Math.max(10, Math.min(240, (TAU * c.R) / (DCELL * 1.4) | 0))
      const rimAmt = 3.6 * dt * (0.5 + this.netEnergy)
      for (let k = 0; k < steps; k++) {
        const ang = (k / steps) * TAU
        // 放射繊維（角度ノイズでリングに濃淡 → 縁が繊維状に見える）
        const fiber = 0.5 + 0.5 * Math.sin(ang * c.fiberFreq + c.seed)
        if (fiber < 0.22) continue
        const rr = c.R * (0.96 + Math.random() * 0.06)
        this.inject(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr, rimAmt * (0.4 + 0.6 * fiber))
      }
      // 中心の柔らかい灯
      this.inject(c.x, c.y, 1.2 * dt)
      // 内部の維持（薄く。被覆が痩せないように）
      const innerN = Math.min(40, (c.R / 14) | 0)
      for (let k = 0; k < innerN; k++) {
        const a = Math.random() * TAU
        const r = Math.sqrt(Math.random()) * c.R * 0.9
        this.inject(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0.9 * dt)
      }
    }
  }

  // 密度: ゆっくり減衰（触れている間は被覆が積み上がる）。離すと後退
  private updateDensity(dt: number, vs: VisualState) {
    const dens = this.dens!
    const dw = this.dw
    const dh = this.dh
    const engaged = vs.held.length > 0 || this.netEnergy > 0.2
    const decay = Math.pow(engaged ? 0.93 : 0.8, dt)
    const cap = 0.8 + 1.2 * vs.arc + 0.6 * vs.arc3
    const diff = 0.13
    for (let j = 0; j < dh; j++) {
      const row = j * dw
      for (let i = 0; i < dw; i++) {
        const c = row + i
        const l = i > 0 ? dens[c - 1] : dens[c]
        const r = i < dw - 1 ? dens[c + 1] : dens[c]
        const u = j > 0 ? dens[c - dw] : dens[c]
        const d = j < dh - 1 ? dens[c + dw] : dens[c]
        let v = dens[c] + diff * ((l + r + u + d) * 0.25 - dens[c])
        v *= decay
        if (v > cap) v = cap
        dens[c] = v < 0.004 ? 0 : v
      }
    }
  }

  // --- 外乱波（波紋・突風）---
  private addRipple(x: number, y: number, amp: number) {
    this.disturbs.push({ ripple: true, x, y, dir: 0, t0: this.t, speed: 140, amp, wl: 90, ttl: 4 })
    if (this.disturbs.length > 6) this.disturbs.shift()
  }

  private addGust(w: number, h: number, amp: number) {
    const dir = Math.random() * TAU
    // 風上の画面外から吹き込む
    const cx = w / 2 - Math.cos(dir) * (Math.max(w, h) * 0.7)
    const cy = h / 2 - Math.sin(dir) * (Math.max(w, h) * 0.7)
    this.disturbs.push({ ripple: false, x: cx, y: cy, dir, t0: this.t, speed: 220, amp, wl: 240, ttl: 9 })
    if (this.disturbs.length > 6) this.disturbs.shift()
  }

  /** 外乱波のサンプル: 変位(dx,dy)と輝度変調 w を返す */
  private waveAt(x: number, y: number): { dx: number; dy: number; w: number } {
    let dx = 0
    let dy = 0
    let wv = 0
    for (const d of this.disturbs) {
      const age = this.t - d.t0
      const fade = Math.max(0, 1 - age / d.ttl)
      if (fade <= 0) continue
      if (d.ripple) {
        const rx = x - d.x
        const ry = y - d.y
        const r = Math.hypot(rx, ry) || 1
        const front = d.speed * age
        const env = Math.exp(-((r - front) ** 2) / (2 * 90 * 90)) * fade
        if (env < 0.01) continue
        const ph = Math.sin(((r - front) / d.wl) * TAU)
        wv += d.amp * ph * env
        const disp = d.amp * ph * env
        dx += (rx / r) * disp
        dy += (ry / r) * disp
      } else {
        const proj = (x - d.x) * Math.cos(d.dir) + (y - d.y) * Math.sin(d.dir)
        const front = d.speed * age
        const env = Math.exp(-((proj - front) ** 2) / (2 * 200 * 200)) * fade
        if (env < 0.01) continue
        const ph = Math.sin(((proj - front) / d.wl) * TAU + y * 0.008 + x * 0.004)
        wv += d.amp * ph * env
        // 風向きと直交にたなびく
        dx += -Math.sin(d.dir) * d.amp * ph * env
        dy += Math.cos(d.dir) * d.amp * ph * env
      }
    }
    return { dx, dy, w: wv }
  }

  // --- 描画 ---
  private drawNature(ctx: CanvasRenderingContext2D, w: number, h: number, vs: VisualState) {
    const ambient = 0.03 + 0.08 * vs.tide
    ctx.font = `${GCELL}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textBaseline = 'top'
    const cols = Math.ceil(w / GCELL)
    const rows = Math.ceil(h / GCELL)
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const px = cx * GCELL
        const py = cy * GCELL
        // まず素の密度で足切り（空セルは波計算しない）
        const raw = this.densAt(px, py)
        const amb = ambient * (0.5 + 0.5 * Math.sin(cx * 0.8 + cy * 0.6 + this.t * 0.7)) * 0.5
        if (raw + amb <= 0.03) continue
        // 外乱波: 変位してサンプル＋輝度変調（場そのものがうねる）
        const wave = this.waveAt(px, py)
        const sway = 3 * Math.sin(cy * 0.5 + this.t * 0.5) // 常時の微かな呼吸
        let d = this.densAt(px + wave.dx * 9 + sway, py + wave.dy * 9)
        d += amb
        if (d <= 0.03) continue
        d *= 1 + 0.35 * wave.w // 波が通ると明滅
        // セル毎の生きた明滅
        d *= 0.86 + 0.14 * Math.sin(cx * 2.1 + cy * 1.3 + this.t * 2.0)
        const idx = Math.min(RAMP.length - 1, Math.max(1, Math.round(Math.min(1, d) * (RAMP.length - 1))))
        const ch = RAMP[idx]
        if (ch === ' ') continue
        const lvl = Math.min(1, d)
        const g = 45 + Math.round(205 * lvl)
        ctx.fillStyle = `rgb(${Math.round(g * 0.14)},${g},${Math.round(g * 0.32)})`
        ctx.fillText(ch, px, py)
      }
    }
  }

  private drawNetwork(ctx: CanvasRenderingContext2D) {
    const e = this.netEnergy
    if (e < 0.02) return
    if (this.nodes.length) {
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(150,255,180,${0.28 * e})`
      ctx.beginPath()
      for (const n of this.nodes) {
        if (n.parent) {
          ctx.moveTo(n.parent.x, n.parent.y)
          ctx.lineTo(n.x, n.y)
        }
      }
      ctx.stroke()
    }
    ctx.font = '10px ui-monospace, monospace'
    ctx.textBaseline = 'bottom'
    for (const n of this.nodes) {
      const blink = 0.55 + 0.45 * Math.sin(this.t * 6 + n.blink)
      const young = Math.max(0, 1 - n.age / n.life)
      const a = e * blink * (0.3 + 0.5 * young)
      if (a < 0.05) continue
      const s = 7 + 14 * young
      ctx.strokeStyle = `rgba(170,255,195,${a})`
      ctx.strokeRect(n.x - s / 2, n.y - s / 2, s, s)
      if (young > 0.45) {
        ctx.fillStyle = `rgba(170,255,195,${a})`
        ctx.fillText(String(n.label), n.x - s / 2 + 1, n.y - s / 2 - 1)
      }
    }
    // コロニー中心の検出枠（成長中はゆっくり点滅）
    for (const c of this.colonies) {
      if (!c.alive) continue
      const blink = 0.5 + 0.5 * Math.sin(this.t * 2.4 + c.seed)
      const a = e * 0.35 * blink
      const s = 18
      ctx.strokeStyle = `rgba(170,255,195,${a})`
      ctx.strokeRect(c.x - s / 2, c.y - s / 2, s, s)
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, vs: VisualState) {
    const a = 0.04 + 0.05 * vs.tide
    ctx.fillStyle = `rgba(120,200,140,${a})`
    for (let y = GCELL; y < h; y += GCELL * 3) for (let x = GCELL; x < w; x += GCELL * 3) ctx.fillRect(x, y, 1, 1)
  }
}
