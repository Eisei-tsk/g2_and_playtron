// Tone.js 生成音楽エンジン（フェーズ1 ステップ4 — 自律ベッド＋触れたエッセンス）
//
// 3層モデル:
//   待機 (無タッチ)  : うっすら短いビープ音がぽつぽつ（スタンバイ）。土台は鳴らない。
//   土台 (bed)       : 触れると development(0→1) が約10秒かけて育ち、自律的なベッド
//                      （コード進行 明↔暗 ＋ パッド/ベース/旋律/アルペジオ）が立ち上がる。
//   エッセンス        : 触れた音をペンタ吸着でベッドに調和させ、その上に乗せる装飾。
//                      触れる数・時間（development）でシマー/エコーが発展する。
//   離す             : development が数秒で減衰し、待機へ戻る。
//
// note 別音色（ステップ5）・IMU 連動（フェーズ2）は後続。

import * as Tone from 'tone'
import { quantizeToPentatonic } from './scale'

// 自律ベッドのコード進行（C メジャー圏。bright=明るさ→フィルター/レジスター）。明→暗→明の弧。
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

// 自律ベッドの旋律（C メジャーペンタ。どのコード上でも協和）
const MELODY_POOL = [72, 74, 76, 79, 81, 84]

const TH = { melody: 0.25, arp: 0.5, essence: 0.35 } // development しきい値
const DEV_RISE = 0.03 // ≈10秒で満開（100ms ごと）
const DEV_FALL = 0.05 // 数秒で待機へ
const VOL = { pad: -12, touch: -9, bass: -15, melody: -12, arp: -16, sparkle: -17, beep: -24 }

let pad: Tone.PolySynth<Tone.AMSynth> | null = null
let touchSynth: Tone.PolySynth<Tone.AMSynth> | null = null
let melody: Tone.PolySynth<Tone.FMSynth> | null = null
let arp: Tone.PolySynth<Tone.FMSynth> | null = null
let sparkle: Tone.PolySynth<Tone.Synth> | null = null
let bass: Tone.Synth | null = null
let beep: Tone.Synth | null = null
let bedGain: Tone.Gain | null = null
let filter: Tone.Filter | null = null
let started = false

// 触れている音（エッセンスの種）
const held = new Map<number, number>()
let chordIndex = 0
let currentChord: Chord = CHORDS[0]
let arpStep = 0
let development = 0
let controlTimer: ReturnType<typeof setInterval> | null = null

const midiToFreq = (m: number) => Tone.Frequency(m, 'midi').toFrequency()
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const humanize = (t: number) => t + Math.random() * 0.025
const heldNotes = () => [...held.values()]

export function isStarted(): boolean {
  return started
}

export function getProgress(): { touches: number; development: number; chord: string } {
  return { touches: held.size, development, chord: currentChord.name }
}

/** AudioContext を解除して音響グラフ・生成ループを構築する。**必ずユーザー操作内で呼ぶ** */
export async function startAudio(): Promise<void> {
  if (started) return
  await Tone.start()

  const limiter = new Tone.Limiter(-3).toDestination()
  const reverb = new Tone.Reverb({ decay: 11, wet: 0.55 }).connect(limiter)
  await reverb.ready
  const chorus = new Tone.Chorus(0.4, 3, 0.35).connect(reverb).start()
  const delay = new Tone.FeedbackDelay('8n.', 0.4).connect(reverb)
  filter = new Tone.Filter(450, 'lowpass').connect(chorus)

  // 土台の音量を development で開閉
  bedGain = new Tone.Gain(0).connect(filter)

  pad = new Tone.PolySynth(Tone.AMSynth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 3.0, decay: 0.6, sustain: 0.9, release: 6.0 },
    harmonicity: 1.5,
  }).connect(bedGain)
  pad.volume.value = VOL.pad

  bass = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 3.0, decay: 0.5, sustain: 1.0, release: 6.0 },
  }).connect(bedGain)
  bass.volume.value = VOL.bass

  melody = new Tone.PolySynth(Tone.FMSynth, {
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.3, release: 2.5 },
    modulationIndex: 4,
  }).connect(delay)
  melody.volume.value = VOL.melody

  arp = new Tone.PolySynth(Tone.FMSynth, {
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 1.5 },
    modulationIndex: 6,
  }).connect(delay)
  arp.volume.value = VOL.arp

  // エッセンス（触れた音）の本体 ＋ シマー
  touchSynth = new Tone.PolySynth(Tone.AMSynth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 1.2, decay: 0.4, sustain: 0.85, release: 4.0 },
    harmonicity: 2.0,
  }).connect(filter)
  touchSynth.volume.value = VOL.touch

  sparkle = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 1.5 },
  }).connect(delay)
  sparkle.volume.value = VOL.sparkle

  // 待機ビープ（うっすら短い）
  beep = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.1 },
  }).connect(reverb)
  beep.volume.value = VOL.beep

  const transport = Tone.getTransport()
  transport.bpm.value = 60

  applyChord(0, Tone.now())

  // コード進行（2小節ごと ≈ 8s）。development が低くても進行は裏で進む
  new Tone.Loop((time) => {
    chordIndex = (chordIndex + 1) % CHORDS.length
    applyChord(chordIndex, time)
  }, '2m').start(0)

  // 土台アルペジオ（現在のコード＋オクターブ。development で開く）
  new Tone.Loop((time) => {
    if (development < TH.arp) return
    const seq = [...currentChord.notes, ...currentChord.notes.map((n) => n + 12)]
    const n = seq[arpStep % seq.length]
    arpStep++
    arp?.triggerAttackRelease(midiToFreq(n), '16n', humanize(time), 0.16 + 0.28 * development)
  }, '16n').start(0)

  // 土台の疎な旋律（ペンタ。development で開く）
  new Tone.Loop((time) => {
    if (development < TH.melody) return
    if (Math.random() > 0.1 + 0.45 * development) return
    melody?.triggerAttackRelease(midiToFreq(pick(MELODY_POOL)), '2n', humanize(time), 0.15 + 0.22 * development)
  }, '4n').start(0)

  // エッセンスのシマー（触れている音のオクターブ上。development が育つと稀に湧く）
  new Tone.Loop((time) => {
    if (development < TH.essence) return
    const notes = heldNotes()
    if (notes.length === 0 || Math.random() > 0.25 + 0.4 * development) return
    sparkle?.triggerAttackRelease(midiToFreq(pick(notes) + 24), '8n', humanize(time), 0.08 + 0.12 * development)
  }, '4n').start(0)

  // 待機ビープ（development が低いとき＝待機時）
  new Tone.Loop((time) => {
    const waiting = 1 - development
    if (waiting < 0.4 || Math.random() > 0.45) return
    beep?.triggerAttackRelease(midiToFreq(pick([84, 88, 91])), '32n', humanize(time), 0.5 * waiting)
  }, '2n').start(0)

  transport.start()
  startControlLoop()
  started = true
}

/** ノートオン。触れた音を即鳴らし（エッセンス）、和声に調和させる。即きらめきで反応 */
export function noteOn(midi: number): void {
  if (!started || !touchSynth) return
  if (held.has(midi)) return
  const q = quantizeToPentatonic(midi)
  held.set(midi, q)
  touchSynth.triggerAttack(midiToFreq(q), undefined, 0.7)
  sparkle?.triggerAttackRelease(midiToFreq(q + 12), '16n', undefined, 0.18) // 触れた瞬間の反応
}

/** ノートオフ */
export function noteOff(midi: number): void {
  if (!started || !touchSynth) return
  const q = held.get(midi)
  if (q === undefined) return
  held.delete(midi)
  touchSynth.triggerRelease(midiToFreq(q))
}

// --- 内部 ---
function applyChord(i: number, time: number) {
  currentChord = CHORDS[i]
  pad?.releaseAll(time)
  pad?.triggerAttack(currentChord.notes.map(midiToFreq), time, 0.5)
  bass?.triggerAttackRelease(midiToFreq(currentChord.bass), '2m', time, 0.8)
}

// 制御レート: development の追従、土台ゲイン、明るさ
function startControlLoop() {
  if (controlTimer) clearInterval(controlTimer)
  controlTimer = setInterval(() => {
    const engaged = held.size > 0
    const target = engaged ? 1 : 0
    const rate = engaged ? DEV_RISE : DEV_FALL
    development += (target - development) * rate

    bedGain?.gain.rampTo(development * 0.95, 0.12) // 土台は development で開く
    const cutoff = 350 + development * 2400 * (0.6 + 0.4 * currentChord.bright)
    filter?.frequency.rampTo(cutoff, 0.15) // 育つほど＆コードが明るいほど開く
  }, 100)
}
