// Conduct — フェーズ1 ステップ3
// ブリッジ(WebSocket)とキーボード fallback の入力を Tone.js エンジンへ流す。
import { useEffect, useRef, useState } from 'react'
import { connectBridge, type NoteMessage } from './ws/bridgeClient'
import { startAudio, noteOn, noteOff, isStarted } from './audio/engine'

// キーボード fallback: 1–9 を MIDI ノートにマップ（押下=on / 離す=off）。
// Playtron が無くてもブラウザだけで試せる開発補助。
const KEY_NOTES: Record<string, number> = {
  '1': 60, '2': 62, '3': 64, '4': 65, '5': 67,
  '6': 69, '7': 71, '8': 72, '9': 74,
}

function App() {
  const [audioReady, setAudioReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [active, setActive] = useState<number[]>([])
  const activeRef = useRef<Set<number>>(new Set())

  // 入力（ブリッジ / キーボード共通）を1か所で処理する
  const handleNote = (note: number, on: boolean) => {
    if (!isStarted()) return // Start 前は無視
    if (on) {
      if (activeRef.current.has(note)) return
      activeRef.current.add(note)
      noteOn(note)
    } else {
      if (!activeRef.current.has(note)) return
      activeRef.current.delete(note)
      noteOff(note)
    }
    setActive([...activeRef.current])
  }

  // ブリッジ(WebSocket)受信
  useEffect(() => {
    return connectBridge({
      onStatus: setConnected,
      onNote: (msg: NoteMessage) => handleNote(msg.note, msg.type === 'noteon'),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // キーボード fallback
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return
      const n = KEY_NOTES[e.key]
      if (n !== undefined) handleNote(n, true)
    }
    const up = (e: KeyboardEvent) => {
      const n = KEY_NOTES[e.key]
      if (n !== undefined) handleNote(n, false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async () => {
    await startAudio()
    setAudioReady(true)
  }

  return (
    <main className="conduct-root">
      <h1>Conduct</h1>
      {!audioReady ? (
        <button className="start-btn" onClick={start}>
          ▶ Start
        </button>
      ) : (
        <>
          <p className={connected ? 'status ok' : 'status'}>
            bridge: {connected ? 'connected' : 'disconnected'}
          </p>
          <p className="hint">Playtron に触れる / キーボード 1–9 で発音</p>
          <p className="notes">{active.length ? active.join('   ') : '—'}</p>
        </>
      )}
    </main>
  )
}

export default App
