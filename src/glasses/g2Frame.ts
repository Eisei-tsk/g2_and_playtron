// G2「手紙」ビュー — ブラウザ「景色」(signalField) の縮約移植（フェーズ2 S2 ①テキストのみ）
//
// 同じシミュレーション（SignalField）を G2 の仮想空間 576×288 で回し、
//   密度場   → ASCII ランプ（濃さ帯ごとの文字セット＋セル固有の明滅/入れ替え）
//   検出     → 枠（四隅＋辺）と `ID:n .87` ラベル。低信頼度はチラつく
//   外乱波   → 密度サンプルの変位・増幅（ブラウザと同じ waveAt）
// をテキスト1枚（改行区切りのグリッド）に落とす。
//
// G2 のフォントは非等幅なので行ごとに桁の実位置はズレる。枠の多少の歪みは
// 「検出 UI のカタカタ感」として許容し、見え方はシミュレーターのスクショで調整する。
// 16階調の輝度は文字では出せない（字形の重さのみ）→ ②画像コンテナのハイブリッドで補う。

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

// 濃さ帯ごとの文字セット（軽い→重い）。ブラウザ版 RAMP_SETS の縮約。
// G2 フォント外の文字（˙ 等）は避け、ASCII と · のみ使う
const RAMP_SETS: string[][] = [
  [' '],
  ['.', '·', ','],
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

export class G2Frame {
  private field = new SignalField()

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

    return grid
      .map((row) => row.map(padCell).join('').replace(/ +$/, ''))
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
        const band = Math.min(RAMP_SETS.length - 1, Math.max(1, Math.round(rel * (RAMP_SETS.length - 1))))
        const set = RAMP_SETS[band]
        const swap = Math.floor(t / (0.9 + h2 * 1.6) + h1 * 12)
        grid[cy][cx] = set[(swap + ((h1 * 31) | 0)) % set.length]
      }
    }
  }

  // 検出ボックス → 枠＋ラベル（drawDetections の縮約）
  private paintDetections(grid: string[][]) {
    const e = this.field.energy
    if (e < 0.03) return
    const t = this.field.time
    // ラベルは 48×13 のグリッドでは場所を食いすぎる（ブラウザの 10px 文字と違い
    // 1ラベルで 6〜8 セル）。信頼度上位の少数だけに付ける
    const labeled = new Set(
      [...this.field.detections]
        .filter((d) => d.conf > 0.5 && d.colonyId !== null)
        .sort((a, b) => b.conf - a.conf)
        .slice(0, 3)
        .map((d) => d.id),
    )
    for (const d of this.field.detections) {
      // 低信頼度のチラつき（ブラウザと同じ条件で「消える瞬間」を作る）
      if (d.conf < 0.45 && Math.sin(t * 22 + d.phase) < -0.1) continue
      const x0 = Math.max(0, Math.min(COLS - 1, Math.round((d.x - d.w / 2) / CW)))
      const x1 = Math.max(0, Math.min(COLS - 1, Math.round((d.x + d.w / 2) / CW)))
      const y0 = Math.max(0, Math.min(ROWS - 1, Math.round((d.y - d.h / 2) / CH)))
      const y1 = Math.max(0, Math.min(ROWS - 1, Math.round((d.y + d.h / 2) / CH)))
      if (x1 - x0 < 1 || y1 - y0 < 1) {
        // セル未満の小さな検出は単独マーカー
        grid[y0][x0] = '+'
        continue
      }
      if (d.colonyId !== null) {
        // コロニー検出（主役の大箱）だけフル枠。辺で密度場を食いすぎないよう他は四隅のみ
        for (let x = x0 + 1; x < x1; x++) {
          grid[y0][x] = '-'
          grid[y1][x] = '-'
        }
        for (let y = y0 + 1; y < y1; y++) {
          grid[y][x0] = '|'
          grid[y][x1] = '|'
        }
      }
      grid[y0][x0] = '+'
      grid[y0][x1] = '+'
      grid[y1][x0] = '+'
      grid[y1][x1] = '+'
      // ラベルは信頼度が上がった大きめの箱（コロニー検出）だけに
      if (labeled.has(d.id)) {
        const label = `ID:${d.id} .${Math.round(d.conf * 100)
          .toString()
          .padStart(2, '0')}`
        for (let k = 0; k < label.length && x0 + 1 + k < x1; k++) {
          grid[y0][x0 + 1 + k] = label[k]
        }
      }
    }
  }
}
