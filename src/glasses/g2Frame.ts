// G2「受信の窓」— ブラウザ「景色」(signalField) の縮約移植（フェーズ2 S2 テキストのみ）
//
// シミュレーション（コロニー成長・伝播・外乱波・状態）はブラウザと同一の
// SignalField を 576×288 で回す。役割分担（2026-07-16 確定）:
//   ブラウザ = 認識装置の窓（自然の場 ＋ 検出ボックス・検索網・ID ラベル）
//   グラス   = 受信の窓（自然の場の ASCII のみ。枠・網・ラベルは描かない）
// 同じ自然を2つの装置が別々に翻訳する構図。グラス側は「数」と「規模」だけを
// 横長の画角（44×10 セル）に合わせて調整する:
//   規模     → コロニー同時 6個・大型・伝播距離 1.6倍（G2_TUNING。枠いっぱいに散る）
//   密度場   → ASCII ランプ（cap 正規化＋セル固有の明滅/入れ替え）
//   縁の光   → 「縁は重い字」への翻訳（リング近傍のセルは字形帯を持ち上げる）
//   揺らぎ   → ブラウザ drawNature と同式: うねり変位（場所ごとに振幅・向き・速さが
//              変わる）＋大きな呼吸のパッチ＋外乱波＋明滅。空間スケールも
//              ブラウザのセル単位（15px）に換算して一致させる
//
// フォントは非等幅のため、実測の文字幅テーブル＋誤差拡散レイアウト（layoutRow）で
// 桁を揃える。フレームは**全て ASCII・999 バイト以内・1回で全置換**
// （多バイト文字や分割送信・行末の埋めスペースはフレーム崩壊の元。CLAUDE.md 参照）。

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
// ブラウザ drawNature のセルサイズ（px）。揺らぎの空間スケールを合わせる換算に使う
const BROWSER_CELL = 15

// グリフの実幅（px, シミュレーター実測。実機では要再測定）。未登録は 10 とみなす
const GLYPH_W: Record<string, number> = {
  ' ': 5,
  '.': 5, ',': 5, ';': 5, '·': 5, 'i': 5, 'I': 5, '/': 5, '\\': 5,
  ':': 4, '|': 4, '!': 4,
  '(': 6, ')': 6, 't': 6,
  '1': 7, '[': 7, ']': 7, 'r': 7, 'f': 7,
  '*': 8, '_': 9, 'L': 9,
  '-': 10, 'o': 10, '+': 10, '=': 10, 'e': 10, 'c': 10, 's': 10, '<': 10, '>': 10,
  'x': 11, 'a': 11, 'v': 11, 'n': 11, 'u': 11, 'y': 11, 'k': 11, '2': 11,
  '7': 12, 'Z': 12, '0': 12, '8': 12, 'D': 12, '5': 12, '4': 12, 'R': 12, '?': 12, '3': 12, '6': 12, '9': 12,
  '#': 14, '%': 14, '&': 15, 'M': 16, 'W': 16, '@': 17,
  '─': 20, '│': 20, '┌': 20, '┐': 20, '└': 20, '┘': 20,
}
const SPACE_W = 5
const glyphW = (c: string) => GLYPH_W[c] ?? 10
// textContainerUpgrade 1回の content 上限 999 バイトに対するフレーム予算（余裕込み）
const FRAME_BYTE_BUDGET = 990
// 明暗→字の重さ翻訳のガンマ（大きいほど暗部が深く沈む。1で線形）
const BRIGHT_GAMMA = 2

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
// ブラウザは rAF（~16ms）で回るがG2は ~180ms/フレーム。密度の拡散（にじみ）は
// 「update 1回につき1回」かかるため、substep をブラウザの 60fps と同じ 16ms に
// 刻んで回転数を揃える（45ms だと拡散が 1/3 になり、コロニーの縁が内側へ
// にじまず「輪っかのまま塗りつぶされない」）
const SUBSTEP_MS = 16

// G2 用の規模チューニング（挙動は同一・数と大きさだけ横長画角に合わせる）。
// ブラウザは中型コロニー22個の「重なり」で面を塗る。G2 も数で重ねる方向に寄せる
const G2_TUNING = {
  maxColonies: 14,
  colonyRadius: [0.16, 0.32] as [number, number],
  spreadScale: 1.3,
}

// 濃さ帯ごとの文字セット（軽い→重い）。文字はブラウザと一致させず、
// 「全て ASCII・実幅 12px 以下」の制約内でバリエーションを最大化する
// （2026-07-16 拡充: 2〜4種/帯 → 5〜10種/帯・計41種。full 時に 0/8 だけが
//  並んで止まって見える問題への対策。% & は 14/15px で規格外のため不採用）
const RAMP_SETS: string[][] = [
  [' '],
  ['.', ','],
  [':', ';', '/', '\\', '(', ')'],
  ['+', '=', 'i', '!', 'r', 't', 'f', '[', ']'],
  ['*', 'o', 'x', 'v', 's', 'c', 'e', 'n', 'u', 'L'],
  ['Z', '7', '2', '3', '9', 'a', 'y', 'k', '?'],
  ['8', '0', 'R', '4', '6'],
]

const TAU = Math.PI * 2
const cellHash = (cx: number, cy: number) => {
  const s = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export class G2Frame {
  private field = new SignalField(G2_TUNING)

  /** 1フレーム分のテキスト（改行区切り・行末トリム・999バイト以内）を生成する。
   * title=true でタイトル蓋（CONDUCT + connecting...）を薄い漂いの上に重ねる */
  build(vs: VisualState, dtMs: number, title = false): string {
    let rem = Math.min(dtMs, 400)
    while (rem > 0) {
      const step = Math.min(rem, SUBSTEP_MS)
      this.field.update(G2_W, G2_H, vs, step)
      rem -= step
    }

    const grid: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(' '))
    if (title) {
      this.stampTitle(grid) // 蓋は黒地にタイトルのみ（漂いも描かない）
    } else {
      this.paintNature(grid, vs)
    }

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

  // タイトル蓋: 音が始まる前（ブラウザで Connect される前）は黒地にタイトルのみ。
  // ボタンは無い（AudioContext の解錠はブラウザ側の gesture が担う）
  private stampTitle(grid: string[][]) {
    const text = 'CONDUCT'
    const width = text.length * 2 - 1 // 1セル空きのレタースペーシング
    let cx = Math.max(0, Math.floor((COLS - width) / 2))
    for (const ch of text) {
      grid[4][cx] = ch
      cx += 2
    }
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

  // 密度場 → ASCII。ブラウザ drawNature の揺らぎ一式（うねり変位・呼吸パッチ・
  // 外乱波・セル固有の明滅・文字入れ替え）を同じ式・同じ空間スケールで移植
  private paintNature(grid: string[][], vs: VisualState) {
    const t = this.field.time
    const ambient = 0.03 + 0.08 * vs.tide
    const rims = this.field.colonyList.filter((c) => c.alive && c.R > 20)
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        const px = PAD + (cx + 0.5) * CW
        const py = PAD + (cy + 0.5) * CH
        // 揺らぎはブラウザと同じ空間スケールで（ブラウザの15pxセル単位に換算）
        const bx = px / BROWSER_CELL
        const by = py / BROWSER_CELL
        const h1 = cellHash(cx, cy)
        const h2 = cellHash(cx + 57, cy + 91)
        const amb = ambient * (0.5 + 0.5 * Math.sin(bx * 0.8 + by * 0.6 + t * 0.7)) * 0.5
        const wave = this.field.waveAt(px, py)
        // うねりの向き・速さも場所でゆるやかに変わる（低周波の空間変化。ブラウザと同式）
        const swayAmp = 2 + 2.5 * (0.5 + 0.5 * Math.sin(bx * 0.11 - by * 0.07))
        const swayX = swayAmp * Math.sin(by * 0.4 + t * (0.35 + 0.3 * h2) + h1 * TAU)
        const swayY = swayAmp * 0.6 * Math.cos(bx * 0.3 - t * (0.25 + 0.2 * h1))
        const d = this.field.densityAt(px + wave.dx * 9 + swayX, py + wave.dy * 9 + swayY) + amb
        if (d <= 0.03) continue
        // 明暗の揺らぎ（ブラウザでは緑の明度になる変調）を係数 m として分離。
        // 式は drawNature と同一: 波の増幅・呼吸のパッチ・セル固有の明滅
        let m = 1 + 0.35 * wave.w
        m *= 0.92 + 0.08 * Math.sin(bx * 0.12 - t * 0.4) * Math.cos(by * 0.1 + t * 0.3)
        const blinkFreq = 1.2 + 2.6 * h1
        const blinkAmp = 0.08 + 0.16 * h2
        m *= 1 - blinkAmp + blinkAmp * Math.sin(t * blinkFreq + h1 * TAU)
        // 明暗 → 字の重さへの翻訳。グラスには輝度が無いので、明るさの揺らぎを
        // 帯レベルに乗算する: 暗い瞬間は帯が落ち、谷では . , まで沈み、明るく
        // 戻れば元の重さへ。ガンマで谷を深くし（6段階の量子化でも見えるように）、
        // 端数は確率的丸め＝時間ディザでフレーム間の連続階調にする。
        // 飽和領域（min(1,d)=1 で明暗が消えていた full の面）でも波打ちが見える
        let bandF = Math.min(1, d) * (RAMP_SETS.length - 1)
        bandF *= Math.pow(Math.max(0.3, Math.min(1.6, m)), BRIGHT_GAMMA)
        let band = Math.floor(bandF) + (Math.random() < bandF - Math.floor(bandF) ? 1 : 0)
        band = Math.min(RAMP_SETS.length - 1, Math.max(1, band))
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
}
