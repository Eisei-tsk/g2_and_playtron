// G2 フォント幅キャリブレーション用のテストフレーム（開発ツール）
//
// G2 のフォントは非等幅で、文字ごとの実幅が分からないと桁が揃えられない。
// `?g2cal=N` でこのフレームをグラスに流し、シミュレーターの
// `/api/screenshot/glasses` から各行の右端ピクセルを測って
// 「1文字あたりの実幅 = (右端 - 左パディング) / 繰り返し数」を得る。
// 測定結果は g2Frame.ts の GLYPH_W に反映する（実機では要再測定）。

import { layoutRow, COLS, ROWS } from './g2Frame'

export const CALIB_REPEAT = 24

// 1ページ = 10行（実測: 行送り 26px → 288px に収まるのは 10 行）。
// 行ごとに1グリフを CALIB_REPEAT 回並べる
const PAGES: string[][] = [
  ['.', ',', ':', ';', '|', '+', '=', 'i', '!', '*'],
  ['o', 'x', '7', '#', 'Z', '0', '8', '@', 'M', '·'],
  // スペース行は先頭20スペース+マーカー（マーカー開始位置から逆算）。他はラベル・枠線用
  [' ', '-', '_', '~', '┘', 'I', 'D', 'W', '1', '5'],
  // 文字バリエーション拡充の候補（12px 以下なら場のランプに採用できる）
  ['e', '4', 'R', 'a', 'c', 's', 'v', 'n', 'u', 'r'],
  ['%', '&', '?', '/', '\\', '(', ')', '[', ']', '<'],
  ['>', 't', 'f', 'y', 'k', '2', '3', '6', '9', 'L'],
]

export function buildCalibFrame(page: number): string {
  if (page >= PAGES.length) return buildAlignTest()
  const glyphs = PAGES[Math.max(0, page)]
  return glyphs
    .map((g) => (g === ' ' ? ' '.repeat(20) + '||||' : g.repeat(CALIB_REPEAT)))
    .join('\n')
}

// 整列テスト（?g2cal=3）: 6セルごとに | を立て、行ごとに背景の文字（幅が違う）を変える。
// 誤差拡散レイアウトが正しければ、どの行でも | が縦に揃う
function buildAlignTest(): string {
  const fills = [' ', '.', ':', '8', '+', 'o', ' ', ',', 'Z', 'x']
  const rows: string[] = []
  for (let r = 0; r < ROWS; r++) {
    const row = Array<string>(COLS).fill(fills[r % fills.length])
    for (let c = 0; c < COLS; c += 6) row[c] = '|'
    rows.push(layoutRow(row))
  }
  return rows.join('\n')
}

export const CALIB_PAGES = PAGES.length + 1
