// Conduct — フェーズ1 ステップ4（触れた音から育つ生成音楽）
// 入力を生成エンジンへ流し、待機 / 育ち具合(development) / 層を可視化する。
import { useEffect, useRef, useState } from 'react'
import { connectBridge, type NoteMessage } from './ws/bridgeClient'
import { startAudio, unlockAudio, noteOn, noteOff, isStarted, getProgress } from './audio/engine'
import SignalCanvas from './visual/SignalCanvas'
import { initG2, stopG2, getG2Status, type G2Status } from './glasses/g2'

// キーボード fallback: 1–9 を MIDI ノートにマップ（押下=on / 離す=off）。
const KEY_NOTES: Record<string, number> = {
  '1': 60, '2': 62, '3': 64, '4': 65, '5': 67,
  '6': 69, '7': 71, '8': 72, '9': 74,
}

// デバッグ用タッチ入力（?keys=1）: Playtron/キーボードが無い実機（スマホ）でも
// ノートを触れるように、画面下に 1–9 のタッチパッドを出す
const SHOW_KEYS = new URLSearchParams(window.location.search).has('keys')

// 横持ちモードの判定。縦長（比率1.25超。スマホ縦≈2.16・シミュレーターwebview≈1.29）
// なら中身を90°回転して横として使う。?rot=1 / ?rot=0 で強制切替
const ROT_FORCE = new URLSearchParams(window.location.search).get('rot')
const isRotated = () => {
  if (ROT_FORCE === '1') return true
  if (ROT_FORCE === '0') return false
  return window.innerHeight > window.innerWidth * 1.25
}


function App() {
  const [audioReady, setAudioReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [rotated, setRotated] = useState(isRotated)
  const [g2, setG2] = useState<G2Status>('idle')
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

  // G2 グラス接続（Even Hub / シミュレーター内でのみ成立。素のブラウザは unavailable）
  useEffect(() => {
    initG2().finally(() => setG2(getG2Status()))
    const id = setInterval(() => setG2(getG2Status()), 1000)
    return () => {
      clearInterval(id)
      stopG2()
    }
  }, [])

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

  // 横持ちモードの追従（画面サイズ変化で判定し直す）
  useEffect(() => {
    const onResize = () => setRotated(isRotated())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 生成状態のポーリング表示
  useEffect(() => {
    if (!audioReady) return
    const id = setInterval(() => setProg(getProgress()), 120)
    return () => clearInterval(id)
  }, [audioReady])

  const start = async () => {
    unlockAudio() // gesture 内で同期的に解錠（グラスタップ由来の pending があっても合流させる）
    await startAudio()
    setAudioReady(true)
  }

  // グラスタップ経由で engine が起動した場合に追従して蓋を開ける
  useEffect(() => {
    if (audioReady) return
    const id = setInterval(() => {
      if (isStarted()) setAudioReady(true)
    }, 500)
    return () => clearInterval(id)
  }, [audioReady])

  const state = prog.touches === 0 ? 'waiting' : prog.development < 0.95 ? 'developing' : 'full'

  return (
    <main className={rotated ? 'conduct-root rotated' : 'conduct-root'}>
      {!audioReady ? (
        <div className="start-screen">
          <h1>Conduct</h1>
          <button className="start-btn" onClick={start}>
            Connect
          </button>
        </div>
      ) : (
        <>
          <SignalCanvas />

          {SHOW_KEYS && (
            <div className="touch-keys">
              {Object.entries(KEY_NOTES).map(([k, n]) => (
                <button
                  key={k}
                  className="touch-key"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    handleNote(n, true)
                  }}
                  onPointerUp={() => handleNote(n, false)}
                  onPointerCancel={() => handleNote(n, false)}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {showDebug && (
            <div className="debug">
              <div className={connected ? 'status ok' : 'status'}>
                bridge: {connected ? 'connected' : 'disconnected'} · g2: {g2}
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
