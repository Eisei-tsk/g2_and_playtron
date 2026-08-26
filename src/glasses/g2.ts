// G2 接続スケルトン（フェーズ2 S1 — テスト環境の疎通）
//
// waitForEvenAppBridge → 全画面テキストコンテナ1つ（isEventCapture:1）を作成し、
// textContainerUpgrade を ~180ms ごとに流す「コマ撮りパイプライン」の疎通を確認する。
// 素のブラウザ（Even Hub / シミュレーター外）ではタイムアウトして 'unavailable' になり、
// ブラウザ側のアート表示には影響しない。
//
// 実際のビジュアル（EXPLORATION §7.2.1 の縮約移植）は次ステップでこの上に載せる。

import {
  waitForEvenAppBridge,
  type EvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  StartUpPageCreateResult,
} from '@evenrealities/even_hub_sdk'

export type G2Status = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error'

const FRAME_MS = 180 // 更新間隔（100〜200ms が目安。上限は実機検証）
const COLS = 46 // テスト用の1行の文字数（非等幅前提のラフ値）

let bridge: EvenAppBridge | null = null
let status: G2Status = 'idle'
let loopTimer: ReturnType<typeof setInterval> | null = null
let frame = 0
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
  startTestLoop()
  return true
}

export function stopG2(): void {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
}

// 疎通テストのフレーム（動きが見えれば textContainerUpgrade ストリーミングが機能している）
function buildTestFrame(f: number): string {
  const spinner = '|/-\\'[f % 4]
  const pos = f % COLS
  const track = '·'.repeat(pos) + '@' + '·'.repeat(COLS - 1 - pos)
  const wave = Array.from({ length: COLS }, (_, i) => {
    const v = Math.sin(i * 0.35 + f * 0.25)
    return v > 0.55 ? '*' : v > 0 ? ':' : v > -0.55 ? '.' : ' '
  }).join('')
  return [
    `CONDUCT — G2 link test ${spinner}`,
    `frame ${String(f).padStart(5, '0')}  (${FRAME_MS}ms/frame)`,
    '',
    track,
    wave,
  ].join('\n')
}

function startTestLoop(): void {
  stopG2()
  frame = 0
  loopTimer = setInterval(async () => {
    if (!bridge || inflight) return
    inflight = true
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 1,
          containerName: 'main',
          contentOffset: 0,
          contentLength: 2000,
          content: buildTestFrame(frame++), // 2000文字以内
        }),
      )
    } catch {
      /* 送信失敗は次フレームで再試行 */
    } finally {
      inflight = false
    }
  }, FRAME_MS)
}
