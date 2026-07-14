// G2「手紙」ビュー — ブラウザ「景色」(signalField) の縮約移植（フェーズ2 S2 ①テキストのみ）
//
// シミュレーション（コロニー成長・検出フィット/ジッタ/カスケード・外乱波）は
// ブラウザと同一の SignalField を 576×288 で回す。挙動と思想はそのまま、
// 「数」と「見せ方」だけをグラスの解像度（48×13 セル・明るさ一律）に合わせて再発明する:
//   規模     → コロニー同時 4個・大型（FieldTuning。1個が画面の 1/4〜1/3）
//   密度場   → ASCII ランプ（cap 正規化＋セル固有の明滅/入れ替え）
//   縁の光   → 「縁は重い字」への翻訳（リング近傍のセルは字形帯を持ち上げる）
//   検出     → コーナーブラケット ┌ ┐ └ ┘（HUD 的）。最大の1個だけフル罫線枠。
//              カスケード検出は誕生アニメ（+ → ブラケット → 場に溶ける）
//   網       → 表示中の箱の中心同士を · の点線で結ぶ（空いたセルにだけ置く）
//   ラベル   → `ID:n .87` を1個だけ、数秒ごとに対象を巡回（スキャンしている感）
//
// G2 のフォントは非等幅なので疑似等幅化（下記 padCell）で桁を揃える。
// 16階調の輝度は文字では出せない → 必要なら ②画像コンテナのハイブリッドで補う。

import { SignalField, type VisualState } from '../visual/signalField'

export const G2_W = 576
export const G2_H = 288
// グリッドの列数・行数。フォントが非等幅のためスクショを見て調整する前提のラフ値
// （シミュレーター実測: 平均字幅 ~9.5px・行高 ~22px、重い字は ~11px。
//  密度の高い行が 576px を超えて折り返すとグリッドが崩れるので、重い字が
//  並んでも収まる幅に抑える。52 桁では飽和時に折り返しが出た）
export const COLS = 48
export const ROWS = 13
const CW = G2_W / COLS
const CH = G2_H / ROWS
// ブラウザは rAF（16ms）で回るがG2は ~180ms/フレーム。dt をそのまま渡すと
// 拡散などフレーム毎の処理の回数が変わりすぎるため、~45ms に刻んで複数回進める
const SUBSTEP_MS = 45

// G2 用の規模チューニング（挙動は同一・数と大きさだけ）
const G2_TUNING = { maxColonies: 4, colonyRadius: [0.18, 0.35] as [number, number] }
// 表示するカスケード検出の上限と寿命（シミュレーション内には多数いてよい。見せるのは生まれたてだけ）
const MAX_CASCADE_SHOWN = 6
const CASCADE_SHOW_AGE = 2.2
// ラベルの巡回間隔（秒）
const LABEL_ROTATE_S = 4

// 濃さ帯ごとの文字セット（軽い→重い）。ブラウザ版 RAMP_SETS の縮約。
// G2 フォント外の文字（˙ 等）は避け、ASCII と · のみ使う
const RAMP_SETS: string[][] = [
  [' '],
  ['.', ','], // ASCII のみ（· は UTF-8 2バイトで 999 バイト制限を圧迫するため場では使わない）
  [':', ';', '|'],
  ['+', '=', 'i', '!'],
  ['*', 'o', 'x', '7'],
  ['#', 'Z', '0', '8'],
  ['@', 'M', '0'], // W はフォント幅が広く行の折り返しを招くので外す
]
// 疑似等幅化: G2 フォントは非等幅で、空白・軽い文字は ~5px しかない
// （疎な行が画面の左半分に潰れ、場が内容で空間的に歪む）。空白セルはスペース2個、
// 幅の狭い文字はスペース1個を足して、どのセルも ~10〜11px に揃える。
// 文字数は最大 ~96×13 ≈ 1250 字で textContainerUpgrade の 2000 字以内に収まる
const NARROW = new Set(['.', '·', ',', ':', ';', '|', '!', 'i', '1'])
const padCell = (c: string) => (c === ' ' ? '  ' : NARROW.has(c) ? c + ' ' : c)

const TAU = Math.PI * 2
const cellHash = (cx: number, cy: number) => {
  const s = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const clampCX = (v: number) => Math.max(0, Math.min(COLS - 1, Math.round(v)))
const clampCY = (v: number) => Math.max(0, Math.min(ROWS - 1, Math.round(v)))
// 点線を置いてよいセル（空か最軽帯。場の絵を壊さない）
const isFaint = (c: string) => c === ' ' || RAMP_SETS[1].includes(c)

type ShownBox = { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number }

export class G2Frame {
  private field = new SignalField(G2_TUNING)

  /** 1フレーム分のテキスト（改行区切り、右端の空白はトリム）を生成する */
  build(vs: VisualState, dtMs: number): string {
    let rem = Math.min(dtMs, 400)
    while (rem > 0) {
      const step = Math.min(rem, SUBSTEP_MS)
      this.field.update(G2_W, G2_H, vs, step)
      rem -= step
    }

    const grid: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(' '))
    this.paintNature(grid, vs)
    this.paintDetections(grid)

    // 各行を固定長（2×COLS 文字）に揃える。フレーム全体が毎回同じ文字数になるので、
    // 分割送信（contentOffset）のオフセットが安定し、前フレームの残骸も必ず上書きされる
    return grid
      .map((row) => {
        const s = row.map(padCell).join('')
        return s + ' '.repeat(Math.max(0, COLS * 2 - s.length))
      })
      .join('\n')
  }

  // 密度場 → ASCII（drawNature の縮約。うねり変位・セル固有の明滅・文字入れ替えを維持）
  private paintNature(grid: string[][], vs: VisualState) {
    const t = this.field.time
    const ambient = 0.03 + 0.08 * vs.tide
    // 密度の上限（cap）は arc で ~2 まで育つ。テキストは輝度が無いぶん、
    // その時点の cap で正規化してから字形帯へ割り当てる（飽和で全面が最重帯に
    // 落ちるのを防ぎ、縁と内側のコントラストを保つ）
    const capNow = 0.8 + 1.2 * vs.arc + 0.6 * vs.arc3
    const rims = this.field.colonyList.filter((c) => c.alive && c.R > 20)
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        const px = (cx + 0.5) * CW
        const py = (cy + 0.5) * CH
        const h1 = cellHash(cx, cy)
        const h2 = cellHash(cx + 57, cy + 91)
        const amb = ambient * (0.5 + 0.5 * Math.sin(cx * 0.8 + cy * 0.6 + t * 0.7)) * 0.5
        const wave = this.field.waveAt(px, py)
        let d = this.field.densityAt(px + wave.dx * 9, py + wave.dy * 9) + amb
        if (d <= 0.03) continue
        d *= 1 + 0.35 * wave.w
        // セルごとに周期・振幅が違う明滅
        const blinkFreq = 1.2 + 2.6 * h1
        const blinkAmp = 0.08 + 0.16 * h2
        d *= 1 - blinkAmp + blinkAmp * Math.sin(t * blinkFreq + h1 * TAU)
        const rel = Math.min(1, d / capNow)
        let band = Math.min(RAMP_SETS.length - 1, Math.max(1, Math.round(rel * (RAMP_SETS.length - 1))))
        // 「明るい縁」の翻訳: 輝度が無いので、リング近傍のセルは字形帯を持ち上げて
        // 重い字の輪郭として浮かばせる（繊維の欠け＝低密度セルはそのまま欠ける）
        if (d > 0.08) {
          for (const c of rims) {
            const dd = Math.abs(Math.hypot(px - c.x, py - c.y) - c.R)
            if (dd < CH * 0.45) {
              band = Math.min(RAMP_SETS.length - 1, band + 2)
              break
            }
          }
        }
        const set = RAMP_SETS[band]
        const swap = Math.floor(t / (0.9 + h2 * 1.6) + h1 * 12)
        grid[cy][cx] = set[(swap + ((h1 * 31) | 0)) % set.length]
      }
    }
  }

  // 検出 → ブラケット/枠/点線/ラベル（drawDetections + drawMesh の再発明）
  private paintDetections(grid: string[][]) {
    const e = this.field.energy
    if (e < 0.03) return
    const t = this.field.time
    const dets = this.field.detections

    // --- 選抜: コロニー箱は全部（≤4）、カスケード箱は生まれたての少数だけ ---
    const colonyBoxes = dets
      .filter((d) => d.colonyId !== null)
      .sort((a, b) => b.w * b.h - a.w * a.h)
    const cascades = dets
      .filter((d) => d.colonyId === null && d.age < CASCADE_SHOW_AGE)
      .sort((a, b) => a.age - b.age)
      .slice(0, MAX_CASCADE_SHOWN)

    const toCells = (d: { x: number; y: number; w: number; h: number }): ShownBox => ({
      x0: clampCX((d.x - d.w / 2) / CW),
      x1: clampCX((d.x + d.w / 2) / CW),
      y0: clampCY((d.y - d.h / 2) / CH),
      y1: clampCY((d.y + d.h / 2) / CH),
      cx: clampCX(d.x / CW),
      cy: clampCY(d.y / CH),
    })

    // --- 点線メッシュ（箱より下・場より上）: コロニー箱同士を最寄り2本で結ぶ ---
    const anchors = colonyBoxes.map(toCells)
    const edges = new Set<string>()
    for (let i = 0; i < anchors.length; i++) {
      const near = anchors
        .map((b, k) => ({ k, d: k === i ? Infinity : Math.hypot(b.cx - anchors[i].cx, b.cy - anchors[i].cy) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 2)
      for (const n of near) {
        if (!isFinite(n.d)) continue
        edges.add(i < n.k ? `${i}-${n.k}` : `${n.k}-${i}`)
      }
    }
    for (const key of edges) {
      const [i, k] = key.split('-').map(Number)
      this.dotLine(grid, anchors[i], anchors[k])
    }

    // --- コロニー箱: ブラケット主体、最大の1個だけフル罫線枠 ---
    colonyBoxes.forEach((d, idx) => {
      if (d.conf < 0.45 && Math.sin(t * 22 + d.phase) < -0.1) return // 低信頼度のチラつき
      const b = toCells(d)
      if (b.x1 - b.x0 < 1 || b.y1 - b.y0 < 1) return
      if (idx === 0) {
        for (let x = b.x0 + 1; x < b.x1; x++) {
          grid[b.y0][x] = '─'
          grid[b.y1][x] = '─'
        }
        for (let y = b.y0 + 1; y < b.y1; y++) {
          grid[y][b.x0] = '│'
          grid[y][b.x1] = '│'
        }
      }
      grid[b.y0][b.x0] = '┌'
      grid[b.y0][b.x1] = '┐'
      grid[b.y1][b.x0] = '└'
      grid[b.y1][b.x1] = '┘'
    })

    // --- カスケード箱: 誕生アニメ（+ 1文字 → ブラケット → 表示から溶けて消える）---
    for (const d of cascades) {
      if (d.conf < 0.45 && Math.sin(t * 22 + d.phase) < -0.1) continue
      const b = toCells(d)
      if (d.age < 0.35 || b.x1 - b.x0 < 1 || b.y1 - b.y0 < 1) {
        grid[b.cy][b.cx] = '+'
        continue
      }
      grid[b.y0][b.x0] = '┌'
      grid[b.y0][b.x1] = '┐'
      grid[b.y1][b.x0] = '└'
      grid[b.y1][b.x1] = '┘'
      // 発見元と点線で繋ぐ（発見カスケードの連鎖が見えるように）
      const p = dets.find((o) => o.id === d.parentId)
      if (p) this.dotLine(grid, b, toCells(p))
    }

    // --- ラベル: 1個だけ、数秒ごとに対象を巡回（装置がスキャンしている感）---
    const candidates = colonyBoxes.filter((d) => d.conf > 0.5)
    if (candidates.length) {
      const d = candidates[Math.floor(t / LABEL_ROTATE_S) % candidates.length]
      const b = toCells(d)
      const label = `ID:${d.id} .${Math.round(d.conf * 100).toString().padStart(2, '0')}`
      for (let k = 0; k < label.length && b.x0 + 1 + k < COLS; k++) {
        grid[b.y0][b.x0 + 1 + k] = label[k]
      }
    }
  }

  // セル単位の点線（空いたセルにだけ · を置く。箱や場の字は上書きしない）
  private dotLine(grid: string[][], a: ShownBox, b: ShownBox) {
    const steps = Math.max(Math.abs(b.cx - a.cx), Math.abs(b.cy - a.cy))
    for (let k = 1; k < steps; k++) {
      const cx = Math.round(a.cx + ((b.cx - a.cx) * k) / steps)
      const cy = Math.round(a.cy + ((b.cy - a.cy) * k) / steps)
      if (isFaint(grid[cy][cx])) grid[cy][cx] = '·'
    }
  }
}
