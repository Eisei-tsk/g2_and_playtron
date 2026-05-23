// Conduct — フェーズ1 ステップ4（触れた音から育つ生成音楽）
// 入力を生成エンジンへ流し、待機 / 育ち具合(development) / 層を可視化する。
import { useEffect, useRef, useState } from 'react'
import { connectBridge, type NoteMessage } from './ws/bridgeClient'
import { startAudio, noteOn, noteOff, isStarted, getProgress } from './audio/engine'

// キーボード fallback: 1–9 を MIDI ノートにマップ（押下=on / 離す=off）。
const KEY_NOTES: Record<string, number> = {
  '1': 60, '2': 62, '3': 64, '4': 65, '5': 67,
  '6': 69, '7': 71, '8': 72, '9': 74,
}

// development しきい値で点灯する層（engine の TH と対応）
const LAYERS: { name: string; th: number }[] = [
  { name: 'bed', th: 0.02 },
  { name: 'melody', th: 0.25 },
  { name: 'arp', th: 0.5 },
  { name: 'sparkle', th: 0.75 },
]

function App() {
  const [audioReady, setAudioReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [active, setActive] = useState<number[]>([])
  const [prog, setProg] = useState({ touches: 0, development: 0, chord: '—' })
  const activeRef = useRef<Set<number>>(new Set())

  const handleNote = (note: number, on: boolean) => {
    if (!isStarted()) return
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

  // 生成状態のポーリング表示
  useEffect(() => {
    if (!audioReady) return
    const id = setInterval(() => setProg(getProgress()), 120)
    return () => clearInterval(id)
  }, [audioReady])

  const start = async () => {
    await startAudio()
    setAudioReady(true)
  }

  const state = prog.touches === 0 ? 'waiting' : prog.development < 0.95 ? 'developing' : 'full'

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

          <p className="state">{state === 'waiting' ? 'waiting' : `${state} · ${prog.chord}`}</p>

          <div className="meter">
            <div className="meter-fill" style={{ width: `${Math.round(prog.development * 100)}%` }} />
          </div>

          <div className="layers">
            <span className={prog.touches === 0 ? 'layer on' : 'layer'}>
              {prog.touches === 0 ? '●' : '○'} waiting
            </span>
            {LAYERS.map((l) => (
              <span key={l.name} className={prog.development >= l.th ? 'layer on' : 'layer'}>
                {prog.development >= l.th ? '●' : '○'} {l.name}
              </span>
            ))}
          </div>
        </>
      )}
    </main>
  )
}

export default App
