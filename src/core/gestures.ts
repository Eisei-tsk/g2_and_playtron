// ジェスチャ解析（headless）— EXPLORATION §6「インタラクションの語彙」
//
// noteon/noteoff の時間パターンから「触れ方」を会話的な kind に分類する。
// 音・ビジュアル双方がこの分類を購読する（共有レイヤー）。
//
// 振る舞い（5+1）:
//   greeting    一瞬触れて離す      (<300ms の単発)
//   question    連続で叩く          (短間隔の onset が 3 回以上)
//   listening   長く触れ続ける      (>3s の hold)
//   overlapping 複数同時に触れる    (同時 hold >=2)
//   間(silence) は engine 側で「無タッチ時間」として扱う

export type GestureKind = 'greeting' | 'question' | 'listening' | 'overlapping'

export type Gesture = {
  kind: GestureKind
  notes: number[]
  t: number // performance.now()
  strength: number // 0..1
}

// 閾値（EXPLORATION の叩き台。要実機チューニング）
const TAP_MAX_MS = 300 // これ未満の touch は greeting 候補
const HOLD_MS = 3000 // これ以上の hold で listening
const Q_GAP_MS = 600 // この間隔以内の連打を 1 つの問いかけ束に
const Q_MIN_COUNT = 2 // 問いかけと見なす onset 数（2タップ）
const Q_REFRACTORY_MS = 800 // 問いかけ検知後の不応期（greeting 抑制にも使う）

type Hold = { tOn: number; listened: boolean }

export class GestureAnalyzer {
  private holds = new Map<number, Hold>()
  private onsets: number[] = [] // 直近の onset 時刻
  private lastQuestionAt = -Infinity
  private current: GestureKind | null = null
  private readonly onGesture: (g: Gesture) => void

  constructor(onGesture: (g: Gesture) => void) {
    this.onGesture = onGesture
  }

  noteOn(note: number, t: number): void {
    this.holds.set(note, { tOn: t, listened: false })

    // 同時押し → overlapping
    if (this.holds.size >= 2) {
      this.emit('overlapping', [...this.holds.keys()], t, Math.min(1, this.holds.size / 4))
    }

    // 連打 → question
    this.onsets.push(t)
    this.onsets = this.onsets.filter((x) => t - x <= Q_GAP_MS * Q_MIN_COUNT)
    const burst = this.onsets.filter((x) => t - x <= Q_GAP_MS * (Q_MIN_COUNT - 1))
    if (burst.length >= Q_MIN_COUNT && t - this.lastQuestionAt > Q_REFRACTORY_MS) {
      this.lastQuestionAt = t
      this.emit('question', [...this.holds.keys()], t, Math.min(1, burst.length / 6))
    }
  }

  noteOff(note: number, t: number): void {
    const h = this.holds.get(note)
    if (!h) return
    this.holds.delete(note)
    const dur = t - h.tOn

    // 一瞬で離した単発 → greeting（直前に問いかけ束がなければ）
    if (dur < TAP_MAX_MS && t - this.lastQuestionAt > Q_REFRACTORY_MS && this.holds.size === 0) {
      this.emit('greeting', [note], t, 1 - dur / TAP_MAX_MS)
    }
    if (this.holds.size === 0) this.current = null
  }

  /** 定期呼び出し: 長押し（listening）の検知 */
  tick(now: number): void {
    for (const [note, h] of this.holds) {
      if (!h.listened && now - h.tOn >= HOLD_MS) {
        h.listened = true
        this.emit('listening', [note], now, Math.min(1, (now - h.tOn) / (HOLD_MS * 3)))
      }
    }
  }

  /** UI/デバッグ用: 今アクティブな kind */
  getCurrentKind(): GestureKind | null {
    return this.current
  }

  getHeldCount(): number {
    return this.holds.size
  }

  private emit(kind: GestureKind, notes: number[], t: number, strength: number) {
    this.current = kind
    this.onGesture({ kind, notes, t, strength })
  }
}
