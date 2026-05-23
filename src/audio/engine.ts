// Tone.js 音響エンジン（フェーズ1 ステップ3 — 基本構成）
//
// 構成: パッド（PolySynth/AMSynth, ゆっくり立ち上がる柔らかい音）→ リバーブ。
// 入力 MIDI ノートはペンタトニックへ吸着してから発音する。
// 時間経過の展開（ステップ4）・note 別音色（ステップ5）は後続で追加する。

import * as Tone from 'tone'
import { quantizeToPentatonic } from './scale'

let pad: Tone.PolySynth<Tone.AMSynth> | null = null
let reverb: Tone.Reverb | null = null
let started = false

// 入力 MIDI ノート → 発音中の量子化ノート（noteoff で正しく止めるため）
const active = new Map<number, number>()

export function isStarted(): boolean {
  return started
}

/** AudioContext を解除して音響グラフを構築する。**必ずユーザー操作内で呼ぶ** */
export async function startAudio(): Promise<void> {
  if (started) return
  await Tone.start()

  reverb = new Tone.Reverb({ decay: 8, wet: 0.6 }).toDestination()
  await reverb.ready

  pad = new Tone.PolySynth(Tone.AMSynth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 2.0, decay: 0.5, sustain: 0.9, release: 5.0 },
    harmonicity: 1.5,
  }).connect(reverb)
  pad.volume.value = -10

  started = true
}

/** ノートオン（同一ノートの二重発音は無視） */
export function noteOn(midi: number): void {
  if (!started || !pad) return
  if (active.has(midi)) return
  const q = quantizeToPentatonic(midi)
  active.set(midi, q)
  pad.triggerAttack(Tone.Frequency(q, 'midi').toFrequency())
}

/** ノートオフ */
export function noteOff(midi: number): void {
  if (!started || !pad) return
  const q = active.get(midi)
  if (q === undefined) return
  active.delete(midi)
  pad.triggerRelease(Tone.Frequency(q, 'midi').toFrequency())
}
