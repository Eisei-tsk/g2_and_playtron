// ペンタトニック量子化
//
// 「何を触っても不協和にならない」ための要。Playtron は端子ごとに固定の
// MIDI ノートを送ってくる（ch は常に 0）。その任意のノートを、最も近い
// ペンタトニック音へ吸着させてから鳴らす。

// ペンタトニックの音名クラス（C D E G A = A マイナーペンタと同一集合）
const PENTATONIC_PCS = [0, 2, 4, 7, 9]

function pc(n: number): number {
  return ((n % 12) + 12) % 12
}

/** 任意の MIDI ノートを最も近いペンタトニック音へ吸着する */
export function quantizeToPentatonic(midi: number): number {
  for (let d = 0; d < 12; d++) {
    if (PENTATONIC_PCS.includes(pc(midi + d))) return midi + d
    if (PENTATONIC_PCS.includes(pc(midi - d))) return midi - d
  }
  return midi
}
