// G2 グラス表示（フェーズ2 S2 — ビジュアル縮約移植 ①テキストのみ）
//
// waitForEvenAppBridge → 全画面テキストコンテナ1つ（isEventCapture:1）を作成し、
// engine の getVisualState() を購読して G2Frame（signalField の縮約レンダラ）が
// 作る ASCII フレームを ~180ms ごとに textContainerUpgrade で流す。
// 素のブラウザ（Even Hub / シミュレーター外）ではタイムアウトして 'unavailable' になり、
// ブラウザ側のアート表示には影響しない。
//
// 音（startAudio）が始まる前は待機状態（薄いドリフトのみ）を流す。
// `?g2demo=1` を付けると合成の VisualState（タッチと発展のスクリプト）で駆動され、
// 音を鳴らさなくてもシミュレーターでビジュアルを検証できる。

import {
  waitForEvenAppBridge,
  type EvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  StartUpPageCreateResult,
} from '@evenrealities/even_hub_sdk'
import { isStarted, getVisualState } from '../audio/engine'
import type { VisualState } from '../visual/signalField'
import { G2Frame } from './g2Frame'

export type G2Status = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error'

const FRAME_MS = 180 // 更新間隔（100〜200ms が目安。上限は実機検証）

let bridge: EvenAppBridge | null = null
let status: G2Status = 'idle'
let loopTimer: ReturnType<typeof setInterval> | null = null
let inflight = false // 前フレームの送信が終わるまで次を送らない

export function getG2Status(): G2Status {
  return status
}

/** G2 への接続とページ初期化。素のブラウザではタイムアウトで諦める */
export async function initG2(timeoutMs = 4000): Promise<boolean> {
  if (status === 'connected' || status === 'connecting') return status === 'connected'
  status = 'connecting'

  const b = await Promise.race([
    waitForEvenAppBridge(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]).catch(() => null)

  if (!b) {
    status = 'unavailable'
    return false
  }
  bridge = b

  try {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            borderWidth: 0,
            borderColor: 0,
            paddingLength: 8,
            containerID: 1,
            containerName: 'main', // 16文字以内
            content: 'CONDUCT', // 起動時は短く（転送効率）
            isEventCapture: 1,
          }),
        ],
      }),
    )
    if (result !== StartUpPageCreateResult.success) {
      status = 'error'
      return false
    }
  } catch {
    status = 'error'
    return false
  }

  status = 'connected'
  startRenderLoop()
  return true
}

export function stopG2(): void {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
}

const isDemo =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('g2demo')

// 音を鳴らす前の待機状態（ゼロ状態でも薄く文字が漂う）
function neutralState(t: number): VisualState {
  return {
    held: [],
    echoes: [],
    gesture: null,
    development: 0,
    arc: 0,
    arc3: 0,
    stage: 0,
    tide: 0.5 + 0.5 * Math.sin(t * 0.06),
    brightness: 0.4,
    shimmer: 0.1,
    breadth: 0,
  }
}

// `?g2demo=1` 用の合成状態。2〜3 ノートのタッチが重なりながら巡回し、
// arc が数分かけて満ちる（実機の「触れられるのは 2〜4 個」を模す）
function demoState(t: number): VisualState {
  const held: number[] = []
  const phase = t % 24
  if (phase < 9) held.push(65)
  if (phase > 4 && phase < 15) held.push(71)
  if (phase > 12 && phase < 20) held.push(60)
  const arc = Math.min(1, t / 120)
  const gestureId = Math.floor(t / 7)
  return {
    held,
    echoes: [],
    gesture: { kind: 'greeting', notes: [held[0] ?? 65], id: gestureId },
    development: Math.min(1, t / 10),
    arc,
    arc3: Math.min(1, t / 300),
    stage: arc > 0.75 ? 3 : arc > 0.5 ? 2 : arc > 0.25 ? 1 : 0,
    tide: 0.5 + 0.5 * Math.sin(t * 0.07),
    brightness: 0.5,
    shimmer: 0.3 + 0.3 * Math.sin(t * 0.11),
    breadth: Math.min(3, Math.ceil(t / 8)),
  }
}

function startRenderLoop(): void {
  stopG2()
  const frame = new G2Frame()
  const t0 = performance.now()
  let last = t0
  loopTimer = setInterval(async () => {
    if (!bridge || inflight) return
    inflight = true
    try {
      const now = performance.now()
      const dt = now - last
      last = now
      const elapsed = (now - t0) / 1000
      const vs = isDemo
        ? demoState(elapsed)
        : isStarted()
          ? (getVisualState() as VisualState)
          : neutralState(elapsed)
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 1,
          containerName: 'main',
          contentOffset: 0,
          contentLength: 2000,
          content: frame.build(vs, dt), // 2000文字以内
        }),
      )
    } catch {
      /* 送信失敗は次フレームで再試行 */
    } finally {
      inflight = false
    }
  }, FRAME_MS)
}
