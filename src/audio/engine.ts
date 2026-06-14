// Tone.js 生成音楽エンジン（フェーズ2 — Tycho 寄りの温かみ / 鼓動 / 明確なセクション）
//
// ベースの構成・雰囲気は維持しつつ調整:
//   - 温かみ(Tycho): fat オシレーターのアナログ感 ＋ 軽いテープ的サチュレーション ＋
//                    高域を丸めミッドレンジ中心 ＋ 温かいコーラス。金属/宇宙感を避ける
//   - 鼓動: まばらな低い lub-dub。拍ではなく「世界が生きている」気配（development/潮で生き生き）
//   - セクション: 30/60/180s で intro→develop→climax→full。各節で新要素＋flourish、stage3 が最も華やか
//   - 減衰: arc は数分かけてゆっくり戻る（stage も実際に下がる）
//   - 曲構造: 触れた音から「再帰モチーフ（テーマ）」を作り反復、stage で厚くなる
//   - パフォーマンス: 全 PolySynth に maxPolyphony（ボイス暴走によるノイズ/停止の対策）
//
// 共有レイヤー（src/core）の worldClock / gestures / echoes を購読する。

import * as Tone from 'tone'
import { quantizeToPentatonic } from './scale'
import { WorldClock, type WorldState } from '../core/worldClock'
import { GestureAnalyzer, type Gesture } from '../core/gestures'
import { EchoStore } from '../core/echoes'

type Chord = { name: string; bass: number; notes: number[]; bright: number }
const CHORDS: Chord[] = [
  { name: 'Cmaj9', bass: 36, notes: [60, 64, 67, 71, 74], bright: 0.9 },
  { name: 'Fmaj9', bass: 41, notes: [53, 57, 60, 64, 67], bright: 0.8 },
  { name: 'G6/9', bass: 43, notes: [55, 59, 62, 64, 69], bright: 0.85 },
  { name: 'Am9', bass: 45, notes: [57, 60, 64, 67, 71], bright: 0.45 },
  { name: 'Em7', bass: 40, notes: [52, 55, 59, 62, 67], bright: 0.4 },
  { name: 'Dm9', bass: 38, notes: [50, 53, 57, 60, 64], bright: 0.3 },
  { name: 'Fmaj9', bass: 41, notes: [57, 60, 64, 65, 72], bright: 0.7 },
  { name: 'Cmaj9', bass: 36, notes: [60, 64, 67, 71, 76], bright: 0.95 },
]
const MELODY_POOL = [72, 74, 76, 79, 81, 84]
const WOOD_POOL = [67, 72, 74, 76, 79, 81]
const DEFAULT_MOTIF = [72, 76, 79, 81]
const SECTIONS = ['intro', 'develop', 'climax', 'full'] as const

const STAGE1 = 30, STAGE2 = 60, STAGE3 = 180
const ARC_MAX = 210
const ARC_DECAY = 0.45 // アイドル時の減衰。数分で intro へ戻る（full→0 ≈ 7.5分、stage1→0 ≈ 70秒）

const VOL = {
  pad: -12, padAir: -19, bass: -14, melody: -11, counter: -13, arp: -15, sparkle: -20, bell: -14,
  beep: -24, wind: -26, bird: -20, drop: -18, heart: -15,
  touchLow: -10, touchMid: -9, touchHigh: -12,
}
const POLY = {
  pad: 6, padAir: 5, melody: 4, counter: 4, arp: 6, sparkle: 6, bell: 6,
  touchLow: 4, touchMid: 4, touchHigh: 4,
}

let pad: Tone.PolySynth<Tone.AMSynth> | null = null
let padAir: Tone.PolySynth<Tone.Synth> | null = null // stage2+ で増す高域の温かいエア
let melody: Tone.PolySynth<Tone.Synth> | null = null
let counter: Tone.PolySynth<Tone.Synth> | null = null
let arp: Tone.PolySynth<Tone.Synth> | null = null
let sparkle: Tone.PolySynth<Tone.Synth> | null = null
let bell: Tone.PolySynth<Tone.Synth> | null = null
let bass: Tone.Synth | null = null
let beep: Tone.Synth | null = null
let heart: Tone.MembraneSynth | null = null
let touchLow: Tone.PolySynth<Tone.AMSynth> | null = null
let touchMid: Tone.PolySynth<Tone.AMSynth> | null = null
let touchHigh: Tone.PolySynth<Tone.AMSynth> | null = null
let wind: Tone.Noise | null = null
let windGain: Tone.Gain | null = null
let bird: Tone.Synth | null = null
let drop: Tone.Synth | null = null
let bedGain: Tone.Gain | null = null
let airGain: Tone.Gain | null = null
let filter: Tone.Filter | null = null
let master: Tone.Gain | null = null
let started = false

const world = new WorldClock(0.37)
let analyzer: GestureAnalyzer | null = null
const echoes = new EchoStore()
const echoStep = new Map<number, number>()

const held = new Map<number, { q: number; band: 'low' | 'mid' | 'high' }>()
const distinctNotes = new Set<number>()
const themeNotes: number[] = []

let chordIndex = 0
let currentChord: Chord = CHORDS[0]
let arpStep = 0
let motifStep = 0
let development = 0
let arcSeconds = 0
let lastStage = 0
let heartPhase = 0
let openBoost = 0 // セクション到来時にフィルターを一気に開く一時ブースト（Hz）
let gainLift = 0 // セクション到来時の一時的な音量リフト
let lastGesture: Gesture | null = null
let worldNow: WorldState = { tide: 0, brightness: 0.5, shimmer: 0 }
let controlTimer: ReturnType<typeof setInterval> | null = null

const midiToFreq = (m: number) => Tone.Frequency(m, 'midi').toFrequency()
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const humanize = (t: number) => t + Math.random() * 0.03
const nowMs = () => performance.now()
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

const arc01 = () => clamp01(arcSeconds / STAGE2)
const arc3 = () => clamp01(arcSeconds / STAGE3)
const breadth = () => Math.min(distinctNotes.size, 16) / 16
// richness: その場 + 1分弧 + 3分弧 + 物の数 + 同時押し数（複数長押しで滲み出る）
const richness = () => clamp01(0.3 * development + 0.5 * arc01() + 0.25 * arc3() + 0.25 * breadth() + 0.12 * (Math.min(held.size, 4) / 4))
const stage = () => (arcSeconds >= STAGE3 ? 3 : arcSeconds >= STAGE2 ? 2 : arcSeconds >= STAGE1 ? 1 : 0)
const motif = () => (themeNotes.length >= 2 ? themeNotes.slice(0, 4) : DEFAULT_MOTIF)
const bandOf = (q: number): 'low' | 'mid' | 'high' => (q < 57 ? 'low' : q < 72 ? 'mid' : 'high')

export function isStarted(): boolean {
  return started
}

export function getProgress() {
  return {
    touches: held.size,
    development,
    chord: currentChord.name,
    tide: worldNow.tide,
    brightness: worldNow.brightness,
    gesture: lastGesture?.kind ?? '—',
    echoes: echoes.count(),
    arc: arc01(),
    arcSeconds,
    stage: stage(),
    section: SECTIONS[stage()],
    breadth: distinctNotes.size,
  }
}

/** AudioContext を解除して音響グラフ・生成ループ・共有レイヤーを構築する。**必ずユーザー操作内で呼ぶ** */
export async function startAudio(): Promise<void> {
  if (started) return
  await Tone.start()

  // --- マスターチェーン: 温かみ（高域を丸める ＋ 軽いテープ的サチュレーション）---
  const limiter = new Tone.Limiter(-3).toDestination()
  master = new Tone.Gain(0.6).connect(limiter) // セクションで音量を上げる makeup
  const highCut = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: -7 }).connect(master) // 高域を丸めミッドレンジ中心（Tycho 寄り）
  const warmth = new Tone.Distortion({ distortion: 0.16, oversample: '2x', wet: 0.24 }).connect(highCut) // テープ的な倍音
  const reverb = new Tone.Reverb({ decay: 7, preDelay: 0.02, wet: 0.46 }).connect(warmth)
  await reverb.ready
  const chorus = new Tone.Chorus(0.4, 3.2, 0.45).connect(reverb).start()
  const delay = new Tone.FeedbackDelay('8n.', 0.32).connect(reverb)
  filter = new Tone.Filter(450, 'lowpass').connect(chorus)
  bedGain = new Tone.Gain(0).connect(filter)
  airGain = new Tone.Gain(0).connect(chorus) // stage2+ のエアパッド

  // 温かいアナログパッド（fat オシレーターでデチューン＝アナログ感）
  pad = new Tone.PolySynth(Tone.AMSynth, {
    oscillator: { type: 'fattriangle', count: 3, spread: 18 },
    envelope: { attack: 3.0, decay: 0.6, sustain: 0.9, release: 7.0 }, harmonicity: 1.2,
  }).connect(bedGain)
  pad.maxPolyphony = POLY.pad
  pad.volume.value = VOL.pad

  // 高域の温かいエア（climax 以降にふわっと増える層）
  padAir = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsine', count: 2, spread: 14 },
    envelope: { attack: 4.0, decay: 1.0, sustain: 0.8, release: 6.0 },
  }).connect(airGain)
  padAir.maxPolyphony = POLY.padAir
  padAir.volume.value = VOL.padAir

  bass = new Tone.Synth({
    oscillator: { type: 'fatsine', count: 2, spread: 10 },
    envelope: { attack: 3.0, decay: 0.5, sustain: 1.0, release: 7.0 },
  }).connect(bedGain)
  bass.volume.value = VOL.bass

  melody = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.7, sustain: 0.12, release: 1.8 },
  }).connect(delay)
  melody.maxPolyphony = POLY.melody
  melody.volume.value = VOL.melody

  counter = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.6, sustain: 0.1, release: 2.2 },
  }).connect(delay)
  counter.maxPolyphony = POLY.counter
  counter.volume.value = VOL.counter

  arp = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.32, sustain: 0, release: 0.5 },
  }).connect(delay)
  arp.maxPolyphony = POLY.arp
  arp.volume.value = VOL.arp

  sparkle = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.35, sustain: 0, release: 1.0 },
  }).connect(delay)
  sparkle.maxPolyphony = POLY.sparkle
  sparkle.volume.value = VOL.sparkle

  bell = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' }, envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.6 },
  }).connect(delay)
  bell.maxPolyphony = POLY.bell
  bell.volume.value = VOL.bell

  touchLow = new Tone.PolySynth(Tone.AMSynth, {
    oscillator: { type: 'fatsine', count: 2, spread: 12 },
    envelope: { attack: 1.6, decay: 0.5, sustain: 0.85, release: 5.5 }, harmonicity: 1.0,
  }).connect(filter)
  touchLow.maxPolyphony = POLY.touchLow
  touchLow.volume.value = VOL.touchLow
  touchMid = new Tone.PolySynth(Tone.AMSynth, {
    oscillator: { type: 'fattriangle', count: 2, spread: 14 },
    envelope: { attack: 1.0, decay: 0.4, sustain: 0.85, release: 4.5 }, harmonicity: 1.3,
  }).connect(filter)
  touchMid.maxPolyphony = POLY.touchMid
  touchMid.volume.value = VOL.touchMid
  touchHigh = new Tone.PolySynth(Tone.AMSynth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.5, decay: 0.4, sustain: 0.7, release: 4.0 }, harmonicity: 1.8,
  }).connect(filter)
  touchHigh.maxPolyphony = POLY.touchHigh
  touchHigh.volume.value = VOL.touchHigh

  // 鼓動（低く丸い lub-dub）
  heart = new Tone.MembraneSynth({
    pitchDecay: 0.05, octaves: 2,
    envelope: { attack: 0.005, decay: 0.35, sustain: 0, release: 0.4 },
  })
  const heartLp = new Tone.Filter(200, 'lowpass').connect(reverb)
  heart.connect(heartLp)
  heart.volume.value = VOL.heart

  // --- 森のエッセンス ---
  windGain = new Tone.Gain(0).connect(reverb)
  const windFilter = new Tone.Filter(600, 'bandpass').connect(windGain)
  windFilter.Q.value = 0.6
  wind = new Tone.Noise('pink').connect(windFilter)
  wind.volume.value = VOL.wind
  wind.start()
  new Tone.LFO({ frequency: 0.07, min: 320, max: 1000 }).connect(windFilter.frequency).start()

  bird = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.12, sustain: 0, release: 0.1 } }).connect(reverb)
  bird.volume.value = VOL.bird
  drop = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.3 } }).connect(delay)
  drop.volume.value = VOL.drop
  beep = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.1 } }).connect(reverb)
  beep.volume.value = VOL.beep

  analyzer = new GestureAnalyzer(onGesture)

  const transport = Tone.getTransport()
  transport.bpm.value = 60
  applyChord(0, Tone.now())

  // コード進行（エアパッドも追従）
  new Tone.Loop((time) => {
    chordIndex = (chordIndex + 1) % CHORDS.length
    applyChord(chordIndex, time)
  }, '2m').start(0)

  // 土台アルペジオ（richness で密度↑。stage3 は2音同時で厚く）
  new Tone.Loop((time) => {
    const r = richness()
    if (r < 0.3) return
    const spread = breadth() > 0.5 ? [0, 12, 24] : [0, 12]
    const seq = currentChord.notes.flatMap((n) => spread.map((o) => n + o))
    arp?.triggerAttackRelease(midiToFreq(seq[arpStep++ % seq.length]), '16n', humanize(time), 0.16 + 0.4 * r)
    if (stage() >= 3) arp?.triggerAttackRelease(midiToFreq(seq[(arpStep + 2) % seq.length]), '16n', humanize(time), 0.12 + 0.25 * r)
  }, '16n').start(0)

  // 再帰モチーフ（テーマ）。stage2+ はオクターブ変奏、stage3 は3度を重ねて厚く
  new Tone.Loop((time) => {
    if (stage() < 1) return
    const m = motif()
    const n = quantizeToPentatonic(m[motifStep % m.length])
    motifStep++
    const oct = stage() >= 2 && motifStep % 8 >= 4 ? 12 : 0
    const tt = humanize(time + (motifStep % 4) * 0.5)
    melody?.triggerAttackRelease(midiToFreq(n + oct), '4n', tt, 0.2 + 0.32 * arc01())
    if (stage() >= 3) melody?.triggerAttackRelease(midiToFreq(quantizeToPentatonic(n + 4) + oct), '4n', tt, 0.12 + 0.2 * arc3())
  }, '1m').start(0)

  // 対旋律（climax 以降。arc3 まで伸びる）
  new Tone.Loop((time) => {
    if (stage() < 2) return
    if (Math.random() > 0.2 + 0.4 * arc01() + 0.3 * arc3()) return
    counter?.triggerAttackRelease(midiToFreq(pick(WOOD_POOL) + 7), '4n', humanize(time), 0.16 + 0.28 * arc01())
  }, '4n').start(0)

  // マレット（木質キラキラ。30s 以降、arc3 まで増える）
  new Tone.Loop((time) => {
    if (arcSeconds < STAGE1 - 5) return
    const p = 0.1 + 0.4 * arc01() + 0.3 * arc3() + 0.3 * breadth() + 0.2 * worldNow.shimmer
    if (Math.random() > p) return
    bell?.triggerAttackRelease(midiToFreq(pick(WOOD_POOL) + 12), '8n', humanize(time), 0.12 + 0.2 * arc01())
  }, '4n').start(0)

  // きらめき（控えめ・温色寄り）
  new Tone.Loop((time) => {
    const p = 0.05 + 0.25 * richness() + 0.18 * worldNow.shimmer
    if (Math.random() > p) return
    const base = held.size > 0 ? [...held.values()][0].q : pick(currentChord.notes)
    const oct = stage() >= 3 ? 24 : 12
    sparkle?.triggerAttackRelease(midiToFreq(quantizeToPentatonic(base) + oct), '16n', humanize(time), 0.06 + 0.1 * richness())
  }, '8n').start(0)

  // 鼓動（まばらな lub-dub。development/潮で生き生き。等間隔の拍にしない）
  new Tone.Loop((time) => {
    heartPhase++
    const life = clamp01(0.2 + 0.6 * development + 0.3 * worldNow.tide)
    if (Math.random() > 0.35 + 0.4 * life) return
    const v = 0.1 + 0.18 * life
    heart?.triggerAttackRelease('C1', '8n', humanize(time), v)
    heart?.triggerAttackRelease('G1', '8n', time + 0.17, v * 0.65)
  }, '2n').start(0)

  // 待機ビープ ＝ 世界の息遣い
  new Tone.Loop((time) => {
    const waiting = 1 - development
    if (waiting < 0.4) return
    if (Math.random() > 0.15 + 0.5 * worldNow.tide) return
    beep?.triggerAttackRelease(midiToFreq(pick([84, 88, 91])), '32n', humanize(time), 0.4 * waiting)
  }, '2n').start(0)

  // ルーパー残響（明確に反復→減衰→積層）。1タップ/2タップもループして消えていく
  new Tone.Loop((time) => {
    const live = echoes.active(nowMs()).slice(-6)
    for (const e of live) {
      const step = echoStep.get(e.id) ?? 0
      echoStep.set(e.id, step + 1)
      if (e.notes.length === 0) continue
      const n = quantizeToPentatonic(e.notes[step % e.notes.length])
      const v = 0.16 * e.level
      if (v < 0.012) continue // 十分に減衰したら無音
      if (e.kind === 'greeting') {
        // 1タップ: 単音が拍に乗ってループしながら減衰
        melody?.triggerAttackRelease(midiToFreq(n + 12), '8n', humanize(time), v)
      } else if (e.kind === 'question') {
        // 2タップ: フレーズがループしながら減衰
        arp?.triggerAttackRelease(midiToFreq(n + 12), '16n', humanize(time), v)
      } else {
        // listening / overlapping: 控えめに反復
        if (step % 2 === 0) arp?.triggerAttackRelease(midiToFreq(n), '16n', humanize(time), v * 0.8)
      }
    }
  }, '2n').start(0) // 2秒ごとに反復（テンポ60。3秒にするなら '2n.'）

  // 森: 遠い鳥
  new Tone.Loop((time) => {
    if (Math.random() > 0.16 + 0.12 * arc01()) return
    const root = pick([88, 91, 93])
    const m = [root, root + 3, root - 2]
    m.slice(0, 2 + Math.floor(Math.random() * 2)).forEach((x, i) => bird?.triggerAttackRelease(midiToFreq(x), '32n', time + i * 0.09, 0.5))
  }, '1m').start(0)

  // 森: 水の滴り
  new Tone.Loop((time) => {
    if (Math.random() > 0.22) return
    drop?.triggerAttackRelease(midiToFreq(pick([79, 83, 86, 90])), '16n', humanize(time), 0.5)
  }, '2n').start(0)

  transport.start()
  startControlLoop()
  started = true
}

/** ノートオン。物ごとの音色で即発音し、breadth とテーマに集計、ジェスチャ解析へ送る */
export function noteOn(midi: number): void {
  if (!started) return
  if (held.has(midi)) return
  const q = quantizeToPentatonic(midi)
  const band = bandOf(q)
  held.set(midi, { q, band })
  distinctNotes.add(midi)
  if (!themeNotes.includes(q)) themeNotes.push(q)
  voiceOf(band)?.triggerAttack(midiToFreq(q), undefined, 0.7)
  analyzer?.noteOn(midi, nowMs())
}

/** ノートオフ */
export function noteOff(midi: number): void {
  if (!started) return
  const h = held.get(midi)
  if (!h) return
  held.delete(midi)
  voiceOf(h.band)?.triggerRelease(midiToFreq(h.q))
  analyzer?.noteOff(midi, nowMs())
}

const voiceOf = (band: 'low' | 'mid' | 'high') => (band === 'low' ? touchLow : band === 'mid' ? touchMid : touchHigh)

// --- ジェスチャ別の応答（会話の語彙）。残響を積んで反芻 ---
function onGesture(g: Gesture) {
  lastGesture = g
  const t = Tone.now()
  const q = g.notes.map(quantizeToPentatonic)
  switch (g.kind) {
    case 'greeting':
      sparkle?.triggerAttackRelease(midiToFreq(q[0] + 12), '16n', t, 0.16 + 0.2 * g.strength)
      echoes.add('greeting', q, g.strength, nowMs())
      break
    case 'question': {
      const ph = q.length ? q : [pick(MELODY_POOL)]
      ph.forEach((n, i) => melody?.triggerAttackRelease(midiToFreq(n + 12), '8n', t + i * 0.12, 0.22))
      echoes.add('question', ph, g.strength, nowMs())
      break
    }
    case 'listening':
      echoes.add('listening', q.length ? q : [...held.values()].map((h) => h.q), g.strength, nowMs())
      break
    case 'overlapping': {
      const ch = [...held.values()].map((h) => h.q)
      ch.forEach((n) => pad?.triggerAttackRelease(midiToFreq(n), '2n', t, 0.4))
      bell?.triggerAttackRelease(midiToFreq(pick(WOOD_POOL) + 12), '8n', t, 0.16)
      echoes.add('overlapping', ch, g.strength, nowMs())
      break
    }
  }
}

// セクション到来の flourish（一気に開ける・壮大に。stage が上がるほど大きく）
function sectionFlourish(toStage: number) {
  const t = Tone.now()
  const ch = currentChord.notes
  // 開く: フィルターと音量を一時的にリフト（control loop で滑らかに収束）
  openBoost = 1800 + 1000 * toStage
  gainLift = 0.18 + 0.09 * toStage
  // 和音とエアの大きな膨らみ
  pad?.triggerAttack(ch.map(midiToFreq), t, 0.6)
  padAir?.triggerAttackRelease(ch.map((n) => midiToFreq(n + 12)), '1m', t, 0.4 + 0.1 * toStage)
  // 上昇カスケード（壮大さ）
  const cascade = [...new Set(ch.flatMap((n) => [n, n + 12, n + 24]))].sort((a, b) => a - b)
  cascade.forEach((n, i) => bell?.triggerAttackRelease(midiToFreq(n), '8n', t + i * 0.07, 0.13 + 0.04 * toStage))
  if (toStage >= 2) ch.forEach((n, i) => sparkle?.triggerAttackRelease(midiToFreq(n + 24), '16n', t + 0.35 + i * 0.07, 0.13))
}

function applyChord(i: number, time: number) {
  currentChord = CHORDS[i]
  pad?.releaseAll(time)
  pad?.triggerAttack(currentChord.notes.map(midiToFreq), time, 0.5)
  if (stage() >= 2) padAir?.triggerAttack(currentChord.notes.map((n) => midiToFreq(n + 12)), time, 0.3)
  bass?.triggerAttackRelease(midiToFreq(currentChord.bass), '2m', time, 0.8)
}

// 制御レート
function startControlLoop() {
  if (controlTimer) clearInterval(controlTimer)
  controlTimer = setInterval(() => {
    const now = nowMs()
    const dt = 0.1
    worldNow = world.sample(now / 1000)
    analyzer?.tick(now)
    echoes.tick(now)

    const engaged = held.size > 0
    arcSeconds = engaged ? Math.min(ARC_MAX, arcSeconds + dt) : Math.max(0, arcSeconds - dt * ARC_DECAY)

    const target = engaged ? 1 : worldNow.tide * 0.15
    development += (target - development) * 0.03

    const s = stage()
    if (s > lastStage) sectionFlourish(s)
    lastStage = s

    const multi = Math.min(held.size, 4) / 4 // 複数長押しで滲み出る
    bedGain?.gain.rampTo(clamp01(development * 0.7 + arc01() * 0.3 + 0.08 * multi) * 0.95, 0.12)
    // エアパッドは climax 以降にふわっと（arc3・複数押しで増える）
    airGain?.gain.rampTo(s >= 2 ? 0.25 + 0.4 * arc3() + 0.1 * multi : 0, 0.4)

    // セクション到来の一時ブーストは滑らかに収束（whoosh → 落ち着く）
    openBoost *= 0.9
    gainLift *= 0.9

    // セクションが進むほど音量が増す（intro はやや小さく、full で最大）＋到来時の一時リフト
    master?.gain.rampTo(0.6 + 0.4 * arc01() + 0.18 * arc3() + gainLift, 0.2)

    const drift = 1 + 0.12 * Math.sin(now / 8000) // アナログ的なフィルターの揺れ
    const cutoff = (350 + (0.5 + 0.5 * richness()) * 2400 * (0.5 + 0.5 * currentChord.bright) * (0.6 + 0.4 * worldNow.brightness)) * drift + openBoost
    filter?.frequency.rampTo(cutoff, 0.15)
    windGain?.gain.rampTo(0.06 + 0.16 * worldNow.tide + 0.06 * richness(), 0.3)
  }, 100)
}
