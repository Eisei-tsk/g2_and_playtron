// 信号フィールドを全画面 canvas に描く（ブラウザ「景色」ビュー）。
// engine.getVisualState() を毎フレーム購読して SignalField に渡す。
import { useEffect, useRef } from 'react'
import { getVisualState, isStarted } from '../audio/engine'
import { SignalField, type VisualState } from './signalField'

export default function SignalCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // ブラウザは「認識装置の窓」: 自然（ASCII の場）は描かず、座標系グリッドと
    // 検索網・検出ボックスだけを見せる（自然の像はグラス側の担当）
    const field = new SignalField({ showNature: false })
    let raf = 0
    let last = performance.now()
    let w = 0
    let h = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      // 横持ちモード（.conduct-root.rotated）では親のレイアウト寸法が
      // 縦横入れ替わるため、window ではなく親要素のサイズに追従する
      const parent = canvas.parentElement
      w = parent ? parent.clientWidth : window.innerWidth
      h = parent ? parent.clientHeight : window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    const loop = (now: number) => {
      const dt = now - last
      last = now
      if (isStarted()) {
        const vs = getVisualState() as VisualState
        field.render(ctx, w, h, vs, dt)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="signal-canvas" />
}
