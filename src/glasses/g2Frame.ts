// G2「手紙」ビュー — ブラウザ「景色」(signalField) の縮約移植（フェーズ2 S2 ①テキストのみ）
//
// シミュレーション（コロニー成長・検出フィット/ジッタ/カスケード・外乱波）は
// ブラウザと同一の SignalField を 576×288 で回す。挙動と思想はそのまま、
// 「数」と「見せ方」だけをグラスの解像度（48×13 セル・明るさ一律）に合わせて再発明する:
//   規模     → コロニー同時 4個・大型（FieldTuning。1個が画面の 1/4〜1/3）
//   密度場   → ASCII ランプ（cap 正規化＋セル固有の明滅/入れ替え）
//   縁の光   → 「縁は重い字」への翻訳（リング近傍のセルは字形帯を持ち上げる）
//   検出     → コーナーマーカー + と枠線 -|（最大の1個だけフル枠）。
//              カスケード検出は誕生アニメ（+ 1点 → 四隅 → 場に溶ける）
//   網       → 表示中の箱の中心同士を . の点線で結ぶ（空いたセルにだけ置く）
//   ラベル   → `ID:n .87` を1個だけ、数秒ごとに対象を巡回（スキャンしている感）
//
// フォントは非等幅のため、実測の文字幅テーブル＋誤差拡散レイアウト（layoutRow）で
// 桁を揃える。フレームは**全て ASCII**（多バイト文字が混ざるとチャンク送信の
// contentOffset がずれてフレームが崩壊する。罫線 ┌─│ は実幅 20px と巨大でもある）。
// 16階調の輝度は文字では出せない → 必要なら ②画像コンテナのハイブリッドで補う。

import { SignalField, type VisualState } from '../visual/signalField'

export const G2_W = 576
export const G2_H = 288
// グリッド。フォントのメトリクスはシミュレーター実測（2026-07-14, Sim 0.7.3）:
//   行送り 26px（288px に収まるのは 10 行。左右上パディング 8px）
//   文字幅はグリフごとにバラバラ（下の GLYPH_W）。セルピッチは 12px とし、
//   12px を超えるグリフ（@ M W # と罫線 20px）は場のランプから外す
export const COLS = 44 // 44×12=528px ≤ 使用可能幅 ~560px（576 - padding 8×2）。46 では端の行が折り返した
export const ROWS = 10
const PITCH = 12 // セルピッチ（px）
const LINE_H = 26 // 行送り（px, 実測）
const PAD = 8 // コンテナの paddingLength
const CW = PITCH
const CH = LINE_H

// グリフの実幅（px, シミュレーター実測。実機では要再測定）。未登録は 10 とみなす
const GLYPH_W: Record<string, number> = {
  ' ': 5,
  '.': 5, ',': 5, ';': 5, '·': 5, 'i': 5, 'I': 5,
  ':': 4, '|': 4, '!': 4,
  '1': 7, '*': 8, '_': 9,
  '-': 10,
  'o': 10, '+': 10, '=': 10,
  'x': 11,
  '7': 12, 'Z': 12, '0': 12, '8': 12, 'D': 12, '5': 12,
  '#': 14, 'M': 16, 'W': 16, '@': 17,
  '─': 20, '│': 20, '┌': 20, '┐': 20, '└': 20, '┘': 20,
}
const SPACE_W = 5
const glyphW = (c: string) => GLYPH_W[c] ?? 10
// textContainerUpgrade 1回の content 上限 999 バイトに対するフレーム予算（余裕込み）
const FRAME_BYTE_BUDGET = 990

/**
 * 誤差拡散レイアウト: セル配列を「実幅を追跡しながら」文字列へ。
 * 各セルの目標 x（cx×PITCH）に対し、実位置が遅れていればスペースで追いつき、
 * 前の幅広グリフがこのセルを覆っていれば置かない。累積ズレを ±3px 程度に抑える。
 * 行末はトリム（トレーリングスペースは LVGL の折り返しを誘発するため厳禁）
 */
export function layoutRow(row: string[]): string {
  let s = ''
  let x = 0
  for (let cx = 0; cx < row.length; cx++) {
    const target = cx * PITCH
    if (x - target >= PITCH / 2) continue // 前のグリフがこのセルまで届いている
    const g = row[cx]
    if (g === ' ') continue
    while (target - x > SPACE_W / 2) {
      s += ' '
      x += SPACE_W
    }
    s += g
    x += glyphW(g)
  }
  return s.replace(/ +$/, '')
}
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
  ['.', ','],
  [':', ';'],
  ['+', '=', 'i', '!'],
  ['*', 'o', 'x'],
  ['Z', '7', 'x'],
  ['8', '0'], // 12px 超のグリフ（@ M W #）は桁ズレの主犯なので使わない
]

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

    // フレームは常に10行ちょうど・行末トリム・全体を1回の textContainerUpgrade で全置換。
    // 999 バイト制限（超過は黙って拒否）があるため、超えそうなら最軽帯のセルを
    // 間引いて予算内に収める（軽い字ほどスペース追い付きで文字数を食う）。
    // フレームは全 ASCII なので バイト数 = 文字数
    let body = grid.map(layoutRow).join('\n')
    if (body.length > FRAME_BYTE_BUDGET) {
      // 1回目: 最軽帯（. ,）を市松に間引く
      this.thinLightCells(grid, 2)
      body = grid.map(layoutRow).join('\n')
    }
    if (body.length > FRAME_BYTE_BUDGET) {
      // 2回目: 最軽帯を全て落とす
      this.thinLightCells(grid, 1)
      body = grid.map(layoutRow).join('\n')
    }
    return body
  }

  // 最軽帯（band1: . ,）のセルを n セルに1個残しで消す
  private thinLightCells(grid: string[][], keepEvery: number) {
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        if (!RAMP_SETS[1].includes(grid[cy][cx])) continue
        if (keepEvery <= 1 || (cx + cy) % keepEvery !== 0) grid[cy][cx] = ' '
      }
    }
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
        const px = PAD + (cx + 0.5) * CW
        const py = PAD + (cy + 0.5) * CH
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

    const cxOf = (x: number) => clampCX((x - PAD) / CW - 0.5)
    const cyOf = (y: number) => clampCY((y - PAD) / CH - 0.5)
    const toCells = (d: { x: number; y: number; w: number; h: number }): ShownBox => ({
      x0: cxOf(d.x - d.w / 2),
      x1: cxOf(d.x + d.w / 2),
      y0: cyOf(d.y - d.h / 2),
      y1: cyOf(d.y + d.h / 2),
      cx: cxOf(d.x),
      cy: cyOf(d.y),
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
        // フレームは全て ASCII（罫線 ┌─│ は実幅 20px と巨大な上、多バイト文字が
        // 混ざるとチャンク送信の offset がずれてフレームが崩壊する）
        for (let x = b.x0 + 1; x < b.x1; x++) {
          grid[b.y0][x] = '-'
          grid[b.y1][x] = '-'
        }
        for (let y = b.y0 + 1; y < b.y1; y++) {
          grid[y][b.x0] = '|'
          grid[y][b.x1] = '|'
        }
      }
      grid[b.y0][b.x0] = '+'
      grid[b.y0][b.x1] = '+'
      grid[b.y1][b.x0] = '+'
      grid[b.y1][b.x1] = '+'
    })

    // --- カスケード箱: 誕生アニメ（+ 1文字 → ブラケット → 表示から溶けて消える）---
    for (const d of cascades) {
      if (d.conf < 0.45 && Math.sin(t * 22 + d.phase) < -0.1) continue
      const b = toCells(d)
      if (d.age < 0.35 || b.x1 - b.x0 < 1 || b.y1 - b.y0 < 1) {
        grid[b.cy][b.cx] = '+'
        continue
      }
      grid[b.y0][b.x0] = '+'
      grid[b.y0][b.x1] = '+'
      grid[b.y1][b.x0] = '+'
      grid[b.y1][b.x1] = '+'
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
      if (isFaint(grid[cy][cx])) grid[cy][cx] = '.'
    }
  }
}
