// 世界の時計（headless）— EXPLORATION §5「循環する世界」
//
// 触れていなくても進む、世界の自律的な呼吸。
// 互いに割り切れない複数周期（≒素数秒）のサインを重ね、完全には反復しない潮を作る。
// 音・ビジュアル双方がこの状態を購読する（共有レイヤー）。

export type WorldState = {
  tide: number // 0..1  世界の潮位（全体の存在感・密度のベース）
  brightness: number // 0..1  明るさの位相（フィルターの開き・レジスター）
  shimmer: number // 0..1  きらめきの揺らぎ（高音の出やすさ）
}

const TAU = Math.PI * 2

// 互いに割り切れない周期（秒）。位相がずれ続けて二度と同じ重なりにならない。
const TIDE_PERIODS = [37, 61, 113] // 主潮（長周期）
const BRIGHT_PERIODS = [29, 71] // 明るさ
const SHIMMER_PERIODS = [17, 43] // きらめき

// 0 中心の合成サイン（重み付き）を 0..1 に正規化
function layered(tSec: number, periods: number[], phase: number): number {
  let sum = 0
  let wsum = 0
  periods.forEach((p, i) => {
    const w = 1 / (i + 1) // 長周期ほど支配的
    sum += w * Math.sin((tSec / p) * TAU + phase * (i + 1))
    wsum += w
  })
  return (sum / wsum) * 0.5 + 0.5
}

export class WorldClock {
  // 起動位相。毎回少し違う世界にするためのオフセット（呼び出し側から与える）
  private readonly phase: number

  constructor(phase = 0) {
    this.phase = phase
  }

  /** 経過秒から現在の世界状態をサンプルする */
  sample(tSec: number): WorldState {
    return {
      tide: layered(tSec, TIDE_PERIODS, this.phase),
      brightness: layered(tSec, BRIGHT_PERIODS, this.phase + 1.7),
      shimmer: layered(tSec, SHIMMER_PERIODS, this.phase + 3.1),
    }
  }
}
