// MIDI ブリッジ（bridge/bridge.js）への WebSocket クライアント。
// 自動再接続あり。受信した noteon/noteoff をコールバックで通知する。

export type NoteMessage = {
  type: 'noteon' | 'noteoff'
  note: number
  velocity: number
  channel: number
  port?: string
}

export type BridgeHandlers = {
  onNote?: (msg: NoteMessage) => void
  onStatus?: (connected: boolean) => void
}

const DEFAULT_URL = 'ws://localhost:8080'

/** ブリッジに接続する。戻り値の関数を呼ぶと切断する。 */
export function connectBridge(handlers: BridgeHandlers, url: string = DEFAULT_URL): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | null = null

  const open = () => {
    ws = new WebSocket(url)

    ws.onopen = () => handlers.onStatus?.(true)

    ws.onclose = () => {
      handlers.onStatus?.(false)
      if (!closed) retry = setTimeout(open, 1500) // 自動再接続
    }

    ws.onerror = () => ws?.close()

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as NoteMessage
        if (msg.type === 'noteon' || msg.type === 'noteoff') handlers.onNote?.(msg)
      } catch {
        /* 壊れたメッセージは無視 */
      }
    }
  }

  open()

  return () => {
    closed = true
    if (retry) clearTimeout(retry)
    ws?.close()
  }
}
