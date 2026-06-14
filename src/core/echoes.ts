// 残響ストア（headless）— EXPLORATION §6.2「反芻（echo / decay / interference）」
//
// 過去の振る舞いを残響オブジェクトとして保持し、時間で減衰させる。
// 完結して消えるのではなく、しばらく場に残って次の行動と干渉する。
// 音・ビジュアル双方がこの active 集合を購読する（共有レイヤー）。

import type { GestureKind } from './gestures'

export type Echo = {
  id: number
  kind: GestureKind
  notes: number[]
  bornAt: number // performance.now()
  ttl: number // 寿命 ms
  strength: number // 生成時の強さ 0..1
}

// kind ごとの既定寿命（ms）。全体的にゆっくり消える（余韻を長く）
const TTL: Record<GestureKind, number> = {
  greeting: 12000, // 1タップもルーパーのように反復→減衰させるため長め
  question: 26000,
  listening: 22000,
  overlapping: 34000,
}

export type LiveEcho = Echo & { age: number; level: number } // level = 現在の存在感 0..1

export class EchoStore {
  private echoes: Echo[] = []
  private nextId = 1

  add(kind: GestureKind, notes: number[], strength: number, now: number): Echo {
    const echo: Echo = { id: this.nextId++, kind, notes, bornAt: now, ttl: TTL[kind], strength }
    this.echoes.push(echo)
    return echo
  }

  /** 期限切れを掃除する */
  tick(now: number): void {
    this.echoes = this.echoes.filter((e) => now - e.bornAt < e.ttl)
  }

  /** 現在アクティブな残響（減衰後の level 付き） */
  active(now: number): LiveEcho[] {
    return this.echoes.map((e) => {
      const age = now - e.bornAt
      const remain = Math.max(0, 1 - age / e.ttl)
      // ease-out 的な減衰（最初はゆっくり、終盤で速く消える）
      const level = e.strength * remain * remain
      return { ...e, age, level }
    })
  }

  count(): number {
    return this.echoes.length
  }

  clear(): void {
    this.echoes = []
  }
}
