// Conduct — フェーズ1 ステップ4（触れた音から育つ生成音楽）
// 入力を生成エンジンへ流し、待機 / 育ち具合(development) / 層を可視化する。
import { useEffect, useRef, useState } from 'react'
import { connectBridge, type NoteMessage } from './ws/bridgeClient'
import { startAudio, noteOn, noteOff, isStarted, getProgress } from './audio/engine'
import SignalCanvas from './visual/SignalCanvas'

// キーボード fallback: 1–9 を MIDI ノートにマップ（押下=on / 離す=off）。
const KEY_NOTES: Record<string, number> = {
  '1': 60, '2': 62, '3': 64, '4': 65, '5': 67,
  '6': 69, '7': 71, '8': 72, '9': 74,
}


function App() {
  const [audioReady, setAudioReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [showDebug, setShowDebug] = useState(true)
  const [active, setActive] = useState<number[]>([])
  const [prog, setProg] = useState({
    touches: 0,
    development: 0,
    chord: '—',
    tide: 0,
    brightness: 0,
    gesture: '—',
    echoes: 0,
    arc: 0,
    arcSeconds: 0,
    stage: 0,
    section: 'intro',
    breadth: 0,
  })
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
      if (e.key === 'd') setShowDebug((v) => !v) // デバッグ表示の切替
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
      {!audioReady ? (
        <div className="start-screen">
          <h1>Conduct</h1>
          <button className="start-btn" onClick={start}>
            ▶ Start
          </button>
        </div>
      ) : (
        <>
          <SignalCanvas />

          {showDebug && (
            <div className="debug">
              <div className={connected ? 'status ok' : 'status'}>
                bridge: {connected ? 'connected' : 'disconnected'}
              </div>
              <div className="hint">Playtron / キーボード 1–9 ・ d: 情報表示</div>
              <div className="notes">{active.length ? active.join(' ') : '—'}</div>
              <div className="state">{state === 'waiting' ? 'waiting' : `${state} · ${prog.chord}`}</div>
              <div className="arc">{prog.section} · stage {prog.stage} · {Math.floor(prog.arcSeconds)}s</div>
              <div className="world">
                <span>gesture: {prog.gesture}</span>
                <span>echoes: {prog.echoes}</span>
                <span>obj: {prog.breadth}/16</span>
              </div>
              <div className="meter arcbar" title="発展の蓄積（arc）">
                <div className="meter-fill" style={{ width: `${Math.round(prog.arc * 100)}%` }} />
              </div>
              <div className="meter tide" title="世界の潮（息遣い）">
                <div className="meter-fill" style={{ width: `${Math.round(prog.tide * 100)}%` }} />
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}

export default App
