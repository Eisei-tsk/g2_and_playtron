// 信号フィールド（procedural）— ブラウザ「景色」ビュー
//
// モデル:
//   主役   : 円形コロニー。中心から放射繊維テクスチャ＋明るい縁の円が育ち、重なり合って
//            画面を満たす（teamLab の花のイメージ）。ASCII は density→字形＋16階調で描く。
//   検出   : 物体検出(bounding box)の振る舞い。装置が「自然（密度の塊）を認識して
//            デジタルに置き換えている」記号。コロニーにフィットした可変サイズの箱が
//            パッと現れ、小刻みにジッタし、信頼度が低いとチラつき、対象消滅でスッと消える。
//            ラベルは ID + 信頼度（参考動画の Life/ID 表記に寄せる）。
//   網     : 枝ではなく「近傍メッシュ」。検出ボックス同士を最寄りで相互接続し、
//            箱の出入りに合わせて張り替わる（認識マップが更新されていく）。
//   うねり : 場そのものに外乱波（ジェスチャ=波紋 / ランダム突風 / セクション=大風）。
//
// 被覆は積み上がる（死滅は局所チャーン）。発展は時間(arc)駆動（触れるのは2〜4個が限界）。
// 配置は best-candidate 散布。状態は engine.getVisualState() を購読（音と同じ core 状態）。

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
// 濃さ帯ごとの文字セット（軽い→重い）。同じ帯の中で文字を散らし、
// グラデーションの重なりを複雑に・データっぽく見せる（@ が最重）
const RAMP_SETS: string[][] = [
  [' '],
  ['.', '·', ','],
  [':', ';', '˙'],
  ['+', '=', 'i', '1', '!'],
  ['*', 'o', 'e', 'x', '7', '4'],
  ['#', 'Z', 'R', '0', '8'],
  ['@', 'M', 'W'],
]
// セル座標から安定した擬似乱数（0..1）
const cellHash = (cx: number, cy: number) => {
  const s = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export type Colony = {
  id: number
  x: number; y: number
  R: number; maxR: number
  age: number; life: number
  seed: number; fiberFreq: number
  alive: boolean
}

// 表示先ごとのチューニング（挙動は同一のまま、規模だけ変える）。
// ブラウザは既定値。G2（48×13 セル相当の解像度）は少数・大型に絞る
export type FieldTuning = {
  /** 同時生存コロニー数の上限（既定 22） */
  maxColonies?: number
  /** コロニー最大半径の min(w,h) に対する割合レンジ（既定 [0.1, 0.24]） */
  colonyRadius?: [number, number]
}
// 検出ボックス（bounding box）。コロニーにフィットし、ジッタ・チラつき・即消滅
export type Det = {
  id: number
  colonyId: number | null // null = 発見カスケードによる検出
  parentId: number | null // 発見元（メッシュの繋がり）
  x: number; y: number; w: number; h: number
  conf: number
  age: number; ttl: number // ttl は発見検出のみ有効（colony 由来は追従）
  aspect: number
  phase: number
}
type Disturb = {
  ripple: boolean
  x: number; y: number; dir: number
  t0: number; speed: number; amp: number; wl: number; ttl: number
}

export class SignalField {
  private tuning: FieldTuning
  constructor(tuning: FieldTuning = {}) {
    this.tuning = tuning
  }

  private colonies: Colony[] = []
  private dets: Det[] = []
  private disturbs: Disturb[] = []
  private assigned = new Map<number, { x: number; y: number }>()
  private dens: Float32Array | null = null
  private dw = 0
  private dh = 0
  private t = 0
  private lastGestureId = -1
  private lastStage = 0
  private surge = 0
  private netEnergy = 0
  private nextGust = 3
  private refitAcc = 0
  private nextColonyId = 1
  private nextDetId = 10

  render(ctx: CanvasRenderingContext2D, w: number, h: number, vs: VisualState, dtMs: number) {
    this.update(w, h, vs, dtMs)

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    this.drawGrid(ctx, w, h, vs)
    this.drawNature(ctx, w, h, vs)
    this.drawMesh(ctx)
    this.drawDetections(ctx)
  }

  /** シミュレーションだけを1ステップ進める（canvas 以外のレンダラ＝G2 テキスト縮約からも使う） */
  update(w: number, h: number, vs: VisualState, dtMs: number) {
    const dt = Math.min(dtMs, 50) / 1000
    this.t += dt
    this.ensureGrid(w, h)

    if (vs.gesture && vs.gesture.id !== this.lastGestureId) {
      this.lastGestureId = vs.gesture.id
      const n = vs.gesture.notes[0] ?? 60
      const p = this.seatOf(n, w, h)
      const amp = vs.gesture.kind === 'overlapping' ? 1.2 : vs.gesture.kind === 'question' ? 0.9 : 0.6
      this.addRipple(p.x, p.y, amp)
    }
    if (vs.stage > this.lastStage) {
      this.surge = 1
      this.addGust(w, h, 1.4)
    }
    this.lastStage = vs.stage
    this.surge *= Math.pow(0.1, dt)

    this.nextGust -= dt * (0.7 + 0.8 * vs.tide + 0.5 * vs.shimmer)
    if (this.nextGust <= 0) {
      this.nextGust = 2.5 + Math.random() * 5
      this.addGust(w, h, 0.5 + Math.random() * 0.5)
    }
    this.disturbs = this.disturbs.filter((d) => this.t - d.t0 < d.ttl)

    // エネルギー（触れると育ち、離すとゆっくり減衰）と種コロニー
    const target = vs.held.length ? 1 : 0
    this.netEnergy += (target - this.netEnergy) * (vs.held.length ? 0.05 : 0.012)
    for (const n of vs.held) {
      const p = this.seatOf(n, w, h)
      const near = this.colonies.some((c) => c.alive && Math.hypot(c.x - p.x, c.y - p.y) < 70)
      if (!near) this.spawnColony(p.x, p.y, w, h)
    }

    this.updateColonies(dt, vs, w, h)
    this.feedColonies(dt)
    this.updateDensity(dt, vs)
    this.updateDetections(dt, vs)
  }

  // --- 外部レンダラ（G2 テキスト縮約）向けの読み取り口 ---
  densityAt(x: number, y: number): number {
    return this.densAt(x, y)
  }
  get detections(): readonly Det[] {
    return this.dets
  }
  get colonyList(): readonly Colony[] {
    return this.colonies
  }
  get energy(): number {
    return this.netEnergy
  }
  get time(): number {
    return this.t
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
        : Math.hypot(cand.x - w / 2, cand.y - h / 2)
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
    if (this.colonies.filter((c) => c.alive).length >= (this.tuning.maxColonies ?? 22)) return
    const base = Math.min(w, h)
    const [r0, r1] = this.tuning.colonyRadius ?? [0.1, 0.24]
    this.colonies.push({
      id: this.nextColonyId++,
      x, y, R: 6,
      maxR: base * (r0 + (r1 - r0) * Math.random()),
      age: 0,
      life: 16 + Math.random() * 18,
      seed: Math.random() * 1000,
      fiberFreq: 10 + (Math.random() * 14 | 0),
      alive: true,
    })
  }

  // --- 円形コロニー: 成長・伝播・死滅（近くで再生）---
  private updateColonies(dt: number, vs: VisualState, w: number, h: number) {
    const grow = (26 + 40 * vs.arc) * (0.5 + this.netEnergy + this.surge)
    for (const c of this.colonies) {
      if (!c.alive) continue
      c.age += dt
      c.R = Math.min(c.maxR * (0.5 + 0.5 * vs.arc + 0.3 * vs.arc3), c.R + grow * dt)
      // 成熟したコロニーは時折、子を伝播（場を広げる役。旧・網の役割をこちらへ）
      if (c.age > 3 && this.netEnergy > 0.15 && Math.random() < dt * (0.06 + 0.12 * vs.arc)) {
        const a = Math.random() * TAU
        const d = 110 + Math.random() * 200
        const nx = Math.min(w - 20, Math.max(20, c.x + Math.cos(a) * d))
        const ny = Math.min(h - 20, Math.max(20, c.y + Math.sin(a) * d))
        this.spawnColony(nx, ny, w, h)
      }
      if (c.age > c.life) {
        c.alive = false
        if (this.netEnergy > 0.05) {
          const a = Math.random() * TAU
          const d = 90 + Math.random() * 200
          this.spawnColony(
            Math.min(w - 20, Math.max(20, c.x + Math.cos(a) * d)),
            Math.min(h - 20, Math.max(20, c.y + Math.sin(a) * d)),
            w, h,
          )
        }
      }
    }
    this.colonies = this.colonies.filter((c) => c.alive || c.age < c.life + 2)
  }

  private feedColonies(dt: number) {
    for (const c of this.colonies) {
      if (!c.alive) continue
      const steps = Math.max(10, Math.min(240, (TAU * c.R) / (DCELL * 1.4) | 0))
      const rimAmt = 3.6 * dt * (0.5 + this.netEnergy)
      for (let k = 0; k < steps; k++) {
        const ang = (k / steps) * TAU
        const fiber = 0.5 + 0.5 * Math.sin(ang * c.fiberFreq + c.seed)
        if (fiber < 0.22) continue
        const rr = c.R * (0.96 + Math.random() * 0.06)
        this.inject(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr, rimAmt * (0.4 + 0.6 * fiber))
      }
      this.inject(c.x, c.y, 1.2 * dt)
      const innerN = Math.min(40, (c.R / 14) | 0)
      for (let k = 0; k < innerN; k++) {
        const a = Math.random() * TAU
        const r = Math.sqrt(Math.random()) * c.R * 0.9
        this.inject(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0.9 * dt)
      }
    }
  }

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

  // --- 検出（bounding box の振る舞い）---
  // コロニー＝大きめの検出対象。加えて既存の検出が近傍を「自発的に発見」し、
  // 大小さまざまな箱が発見元と繋がりながら連鎖的に広がる（枝ではなく箱の増殖）。
  private updateDetections(dt: number, vs: VisualState) {
    for (const d of this.dets) d.age += dt
    // 対象を失った検出は即除去（コロニー消滅 / 密度消失 / 期限切れ）
    this.dets = this.dets.filter((d) => {
      if (this.netEnergy < 0.03) return false
      if (d.colonyId !== null) {
        const c = this.colonies.find((c) => c.id === d.colonyId)
        return !!c && c.alive
      }
      return d.age < d.ttl && d.conf > 0.05
    })

    // 再フィット＋発見（0.16s ごと。検出 UI 特有のカタカタ感）
    this.refitAcc += dt
    if (this.refitAcc < 0.16) return
    this.refitAcc = 0

    // コロニー検出（大きい箱。対象にフィットして追従）
    for (const c of this.colonies) {
      if (!c.alive || c.R < 26 || c.age < 0.4) continue
      let det = this.dets.find((d) => d.colonyId === c.id)
      if (!det) {
        det = {
          id: this.nextDetId++,
          colonyId: c.id,
          parentId: null,
          x: c.x, y: c.y, w: 0, h: 0,
          conf: 0.3,
          age: 0, ttl: Infinity,
          aspect: 0.85 + Math.random() * 0.35,
          phase: Math.random() * TAU,
        }
        this.dets.push(det)
      }
      det.x = c.x + (Math.random() - 0.5) * 5
      det.y = c.y + (Math.random() - 0.5) * 5
      det.w = c.R * 1.9 * det.aspect + (Math.random() - 0.5) * 6
      det.h = (c.R * 1.9) / det.aspect + (Math.random() - 0.5) * 6
      const maturity = Math.min(1, c.age / 4)
      det.conf = Math.min(0.99, (0.35 + 0.6 * maturity) * (0.4 + 0.6 * this.netEnergy))
    }

    // 発見カスケード: 各検出が近傍の密度の特徴を発見 → 新しい箱がポッと生まれ、発見元と繋がる
    const maxDets = Math.floor(36 + 56 * vs.arc) + this.colonies.length
    if (this.dets.length < maxDets) {
      const snapshot = [...this.dets]
      for (const d of snapshot) {
        if (this.dets.length >= maxDets) break
        // 発見確率（エネルギー・arc で連鎖が速まる）
        if (Math.random() > 0.45 * (0.4 + 0.6 * this.netEnergy) * (0.6 + 0.8 * vs.arc)) continue
        const ang = Math.random() * TAU
        const dist = 50 + Math.random() * 170
        const px = d.x + Math.cos(ang) * dist
        const py = d.y + Math.sin(ang) * dist
        const v = this.densAt(px, py)
        if (v < 0.1) continue // 何も無い所は検出しない
        // 重複検出しない
        if (this.dets.some((o) => Math.hypot(o.x - px, o.y - py) < Math.max(20, o.w * 0.35))) continue
        const fit = this.measureExtent(px, py) // 局所の塊にフィット（大小さまざま）
        this.dets.push({
          id: this.nextDetId++,
          colonyId: null,
          parentId: d.id,
          x: px, y: py, w: fit.w, h: fit.h,
          conf: Math.min(0.95, 0.3 + v * 0.75),
          age: 0, ttl: 3.5 + Math.random() * 6,
          aspect: 1,
          phase: Math.random() * TAU,
        })
      }
    }

    // 発見検出の再フィット（ジッタ＋局所密度で信頼度更新。密度が消えたら急減→即消滅）
    for (const d of this.dets) {
      if (d.colonyId !== null) continue
      d.x += (Math.random() - 0.5) * 4
      d.y += (Math.random() - 0.5) * 4
      const v = this.densAt(d.x, d.y)
      d.conf = v < 0.06 ? d.conf * 0.45 : Math.min(0.95, 0.25 + v * 0.75)
    }
  }

  // 局所の塊の広がりを測って箱をフィットさせる（小さな繊維は小箱、太い塊は大箱に）
  private measureExtent(x: number, y: number): { w: number; h: number } {
    const c0 = this.densAt(x, y)
    const th = Math.max(0.08, c0 * 0.35)
    const step = DCELL * 2
    const probe = (dx: number, dy: number) => {
      let k = 1
      while (k <= 9 && this.densAt(x + dx * step * k, y + dy * step * k) > th) k++
      return k * step
    }
    const w = Math.min(130, Math.max(12, probe(1, 0) + probe(-1, 0)))
    const h = Math.min(110, Math.max(12, probe(0, 1) + probe(0, -1)))
    return { w: w * (0.9 + Math.random() * 0.25), h: h * (0.9 + Math.random() * 0.25) }
  }

  // 網＝発見リンク（発見元→発見先）＋コロニー間の近傍メッシュ。箱の出入りで張り替わる
  private drawMesh(ctx: CanvasRenderingContext2D) {
    const e = this.netEnergy
    if (this.dets.length < 2 || e < 0.03) return
    const byId = new Map(this.dets.map((d) => [d.id, d]))
    ctx.lineWidth = 1
    ctx.strokeStyle = `rgba(175,255,200,${0.3 * e})`
    ctx.beginPath()
    // 発見リンク（カスケードの繋がり）
    for (const d of this.dets) {
      if (d.parentId === null) continue
      const p = byId.get(d.parentId)
      if (!p) continue
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(d.x, d.y)
    }
    // コロニー間の近傍メッシュ（最寄り2本）
    const anchors = this.dets.filter((d) => d.colonyId !== null)
    const edges = new Set<string>()
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]
      const near = anchors
        .map((b, k) => ({ k, d: b === a ? Infinity : Math.hypot(b.x - a.x, b.y - a.y) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 2)
      for (const n of near) {
        if (!isFinite(n.d)) continue
        edges.add(i < n.k ? `${i}-${n.k}` : `${n.k}-${i}`)
      }
    }
    for (const key of edges) {
      const [i, k] = key.split('-').map(Number)
      ctx.moveTo(anchors[i].x, anchors[i].y)
      ctx.lineTo(anchors[k].x, anchors[k].y)
    }
    ctx.stroke()
  }

  private drawDetections(ctx: CanvasRenderingContext2D) {
    const e = this.netEnergy
    if (e < 0.03) return
    ctx.font = '10px ui-monospace, monospace'
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = 1
    for (const d of this.dets) {
      // 濃さ・実線は現状維持（薄くしない）
      let a = e * (0.45 + 0.5 * d.conf)
      // 信頼度が低い検出はチラつく（検出が不安定な感じ）
      if (d.conf < 0.45 && Math.sin(this.t * 22 + d.phase) < -0.1) a *= 0.15
      if (a < 0.04) continue
      const x = d.x - d.w / 2
      const y = d.y - d.h / 2
      ctx.strokeStyle = `rgba(185,255,205,${a})`
      ctx.strokeRect(x, y, d.w, d.h)
      // ラベルは信頼度が上がった箱に（極小の箱は枠のみ）
      if (d.conf > 0.5 && d.w > 24) {
        ctx.fillStyle = `rgba(185,255,205,${a})`
        ctx.fillText(`ID:${d.id} ${d.conf.toFixed(2)}`, x + 1, y - 2)
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
    const cx = w / 2 - Math.cos(dir) * (Math.max(w, h) * 0.7)
    const cy = h / 2 - Math.sin(dir) * (Math.max(w, h) * 0.7)
    this.disturbs.push({ ripple: false, x: cx, y: cy, dir, t0: this.t, speed: 220, amp, wl: 240, ttl: 9 })
    if (this.disturbs.length > 6) this.disturbs.shift()
  }

  waveAt(x: number, y: number): { dx: number; dy: number; w: number } {
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
        const raw = this.densAt(px, py)
        const amb = ambient * (0.5 + 0.5 * Math.sin(cx * 0.8 + cy * 0.6 + this.t * 0.7)) * 0.5
        if (raw + amb <= 0.03) continue
        const h1 = cellHash(cx, cy) // セル固有の性格（明滅の速さ・位相・文字の癖）
        const h2 = cellHash(cx + 57, cy + 91)
        const wave = this.waveAt(px, py)
        // うねりの向き・速さも場所でゆるやかに変わる（低周波の空間変化）
        const swayAmp = 2 + 2.5 * (0.5 + 0.5 * Math.sin(cx * 0.11 - cy * 0.07))
        const swayX = swayAmp * Math.sin(cy * 0.4 + this.t * (0.35 + 0.3 * h2) + h1 * TAU)
        const swayY = swayAmp * 0.6 * Math.cos(cx * 0.3 - this.t * (0.25 + 0.2 * h1))
        let d = this.densAt(px + wave.dx * 9 + swayX, py + wave.dy * 9 + swayY)
        d += amb
        if (d <= 0.03) continue
        d *= 1 + 0.35 * wave.w
        // 大きな呼吸のパッチ（領域ごとに膨らみ・沈みのタイミングが違う）
        d *= 0.92 + 0.08 * Math.sin(cx * 0.12 - this.t * 0.4) * Math.cos(cy * 0.1 + this.t * 0.3)
        // セルごとに周期・振幅が違う明滅（一様なさざめきを避ける）
        const blinkFreq = 1.2 + 2.6 * h1
        const blinkAmp = 0.08 + 0.16 * h2
        d *= 1 - blinkAmp + blinkAmp * Math.sin(this.t * blinkFreq + h1 * TAU)
        const band = Math.min(RAMP_SETS.length - 1, Math.max(1, Math.round(Math.min(1, d) * (RAMP_SETS.length - 1))))
        const set = RAMP_SETS[band]
        // 同じ帯の中で文字を散らし、セルごとに違う周期でゆっくり入れ替わる
        const swap = Math.floor(this.t / (0.9 + h2 * 1.6) + h1 * 12)
        const ch = set[(swap + ((h1 * 31) | 0)) % set.length]
        if (ch === ' ') continue
        const lvl = Math.min(1, d)
        const g = 45 + Math.round(205 * lvl)
        ctx.fillStyle = `rgb(${Math.round(g * 0.14)},${g},${Math.round(g * 0.32)})`
        ctx.fillText(ch, px, py)
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, vs: VisualState) {
    const a = 0.04 + 0.05 * vs.tide
    ctx.fillStyle = `rgba(120,200,140,${a})`
    for (let y = GCELL; y < h; y += GCELL * 3) for (let x = GCELL; x < w; x += GCELL * 3) ctx.fillRect(x, y, 1, 1)
  }
}
