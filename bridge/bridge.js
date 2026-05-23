// Conduct — MIDI ブリッジ（フェーズ1 ステップ1）
//
// Playtron(USB) の MIDI を受け取り、WebSocket でブラウザへ配信する。
// Playtron は MIDI ポートを複数見せる（例: "Playtron ポート1" / "ポート2"）。
// 取りこぼし防止のため、条件に一致する全ポートを同時に開く。
//
//   起動:      npm run bridge
//   別名指定:   PLAYTRON_MIDI="デバイス名の一部" npm run bridge
//   ポート等:   WS_PORT=8080（既定） / WS_HOST=127.0.0.1（既定・localhost 限定）
//
// 配信メッセージ（JSON）:
//   { type:'noteon',  note:0-127, velocity:0-127, channel:0-15, port:'Playtron ポート1' }
//   { type:'noteoff', note:0-127, velocity:0-127, channel:0-15, port:'Playtron ポート1' }
//
// channel は easymidi の生値（0-15）。表示上の 1-16 への変換はブラウザ側で行う。

import { WebSocketServer, WebSocket } from 'ws'
import easymidi from 'easymidi'

const WS_PORT = Number(process.env.WS_PORT) || 8080
const WS_HOST = process.env.WS_HOST || '127.0.0.1'
const DEVICE_OVERRIDE = process.env.PLAYTRON_MIDI || ''

// --- WebSocket サーバー（localhost 限定。SECURITY.md §2）---
const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT })

wss.on('listening', () => console.log(`[WS] listening on ws://${WS_HOST}:${WS_PORT}`))
wss.on('connection', () => console.log(`[WS] client connected (clients: ${wss.clients.size})`))
wss.on('error', (err) => console.error('[WS] error:', err.message))

function broadcast(obj) {
  const payload = JSON.stringify(obj)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

// --- MIDI 入力の選択（一致する全ポート）---
function pickInputs(inputs) {
  if (DEVICE_OVERRIDE) {
    const exact = inputs.filter((n) => n === DEVICE_OVERRIDE)
    if (exact.length) return exact
    return inputs.filter((n) => n.toLowerCase().includes(DEVICE_OVERRIDE.toLowerCase()))
  }
  // 既定は名前に "playtron" を含むものを全て選択
  return inputs.filter((n) => /playtron/i.test(n))
}

const midiInputs = [] // [{ input, name }]

function attachHandlers(input, port) {
  input.on('noteon', (msg) => {
    // 一部デバイスは velocity 0 の noteon を noteoff として送る
    const type = msg.velocity === 0 ? 'noteoff' : 'noteon'
    console.log(
      `  ${type === 'noteon' ? '▶' : '■'} ${type.padEnd(7)} port="${port}" ch=${msg.channel} note=${msg.note} vel=${msg.velocity}`,
    )
    broadcast({ type, note: msg.note, velocity: msg.velocity, channel: msg.channel, port })
  })

  input.on('noteoff', (msg) => {
    console.log(`  ■ noteoff port="${port}" ch=${msg.channel} note=${msg.note} vel=${msg.velocity}`)
    broadcast({ type: 'noteoff', note: msg.note, velocity: msg.velocity, channel: msg.channel, port })
  })
}

function openMidi({ verbose = false } = {}) {
  const inputs = easymidi.getInputs()
  if (verbose) console.log('[MIDI] available inputs:', inputs.length ? inputs : '(なし)')

  const names = pickInputs(inputs)
  if (!names.length) return false

  for (const name of names) {
    const input = new easymidi.Input(name)
    attachHandlers(input, name)
    midiInputs.push({ input, name })
    console.log(`[MIDI] opened: "${name}"`)
  }
  console.log('[MIDI] オブジェクトに触れると下に出力されます ↓')
  return true
}

// 起動時に開けなければ、接続されるまで定期再スキャン（USB 後挿し対応）
let rescanTimer = null
if (!openMidi({ verbose: true })) {
  console.log('[MIDI] Playtron が見つかりません。USB 接続後に自動検出します…')
  console.log('       別名の場合は PLAYTRON_MIDI="名前の一部" を指定して再起動してください。')
  rescanTimer = setInterval(() => {
    if (openMidi()) {
      clearInterval(rescanTimer)
      rescanTimer = null
    }
  }, 2000)
}

console.log('[Conduct] MIDI ブリッジ稼働中。Ctrl+C で終了。')

// --- 終了処理 ---
function shutdown() {
  console.log('\n[Conduct] shutting down…')
  if (rescanTimer) clearInterval(rescanTimer)
  for (const { input } of midiInputs) {
    try {
      input.close()
    } catch {
      /* noop */
    }
  }
  wss.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500) // フォールバック
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
