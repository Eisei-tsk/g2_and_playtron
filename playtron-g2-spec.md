# Playtron × G2 — アンビエントアートシステム 仕様書

| 項目 | 内容 |
|---|---|
| バージョン | 0.1.0 |
| 作成日 | 2026-04-06 |
| 対象SDK | @evenrealities/even_hub_sdk v0.0.9 |

---

## 1. Playtron デバイス概要

### 概要

**Playtronica Playtron** は、果物・金属・水・植物などの導電性オブジェクトをMIDIコントローラーに変えるデバイス。アリゲータークリップで最大16個のオブジェクトを接続し、それぞれをピアノの鍵盤のように使える。演奏スキル不要。

> Playtronica は2014年にサーシャ・パスが創設。「日常のオブジェクトから楽器を作る」というコンセプトのもと、Centre Pompidou・IKEA・Nike・エルメスなどとコラボ実績あり。

### 仕組み

**導電性を使った回路の開閉**でMIDI信号を生成する。

```
[オブジェクト] ─ アリゲータークリップ ─ [Playtron ノード端子]
                                                    │
[グランド端子] ─ アリゲータークリップ ─ [もう一方の手/別オブジェクト]
```

ノード端子とグランド端子の両方に同時に触れると回路が閉じ、MIDI Note On が送信される。離すと Note Off。

### ハードウェア仕様

| 項目 | 内容 |
|---|---|
| 接続方式 | USB-A（PC / Mac / タブレット / スマホ） |
| ノード数 | 最大16（各ノードが独立したMIDIノートに対応） |
| グランド端子 | 2つ（どちらに繋いでも動作） |
| サイズ | 約 150 × 80 × 2 mm |
| 同梱品 | USB ケーブル・アリゲータークリップ 18本・収納袋 |
| 防水 | 非対応（水に濡れないよう注意） |

### MIDI 仕様

| パラメータ | 内容 |
|---|---|
| メッセージ種別 | Note On / Note Off のみ |
| Velocity | 固定（強弱なし）。**実機確認: 90**（127 ではなかった。個体/ファーム差の可能性） |
| チャンネル | **実機確認: 常に 0**。オブジェクトの区別はチャンネルではなく **ノート番号**で行う |
| ノート番号 | **端子ごとに固定**（実機確認: ch0 で note=65 / 71 / 75 を観測）。これがノードの識別子 |
| レイテンシ | 0.001秒未満（実質ゼロ） |

> **実機確認済み（2026-05-23）**: MIDI ポートは "Playtron ポート1" / "Playtron ポート2" の2つ。イベントはポート1で観測（ポート2は今回未観測。ブリッジは両方を購読）。**チャンネルは常に 0**、**velocity は 90 固定**、**ノードの区別はノート番号**で行う。全16端子の note 対応表は順次取得する。
>
> 確認手段: 本リポジトリの `bridge/bridge.js`（受信 MIDI をコンソール表示）。MIDIモニター（[Morning Star](https://morningstar.io/midimon) 等）でも可。

### 使用上の注意

- 手や肌が乾燥していると反応しにくい。使用前に手を洗うか保湿クリームを使う
- ペースメーカー装着者は使用不可
- 非導電性オブジェクト（ゴム・プラスチック・木材など）は反応しない
- USBを繋いだ後にブラウザを開く順序が重要（先に挿してからChromeを開く）

### ドキュメント・参考リンク

| リソース | URL |
|---|---|
| 公式ヘルプトップ | https://help.playtronica.com/ |
| Playtron セットアップガイド | https://help.playtronica.com/playtron |
| グラウンディングの仕組み | https://help.playtronica.com/grounding |
| 導電性の物理的な仕組み | https://help.playtronica.com/physics |
| 使えるオブジェクト一覧 | https://help.playtronica.com/objects |
| オンラインシンセとの接続 | https://help.playtronica.com/online |
| DAW連携（Ableton等） | https://help.playtronica.com/daws |
| 他デバイスとの違い | https://help.playtronica.com/different-devices |
| 公式オンラインシンセ | https://synth.playtronica.com/ |
| 製品ページ | https://shop.playtronica.com/products/playtron |

---

## 2. コンセプト

**「触れることで音と映像の世界が動く」**

演奏スキル不要。Playtronに繋いだオブジェクト（果物・金属・水など）に触れることで、Tone.jsが生成するアンビエントサウンドと、グラス上のASCIIビジュアルが変化していく。チームラボ的な「誰でも心地よく感じられる」インタラクティブサウンドインスタレーション。

### 体験の設計思想

- 触れることは「演奏」ではなく「介入」
- 何を触っても不協和にならない（ペンタトニックスケール）
- 触れている長さで音が展開・進化する
- 頭の向き・動きで空間の質感が変わる
- G2グラスは装着者だけが見える私的なビジュアル体験

---

## 3. システム構成

```
Playtron（USB）
  ↓ MIDI Note On/Off
Node.js ブリッジサーバー
（WebMIDI受信 + WebSocketサーバー）
  ↓ WebSocket
ブラウザ / Even Hub WebView（iPhone）
  ├── Tone.js（音生成）
  ├── ASCIIアニメーション（ブラウザ全画面）
  └── G2 SDK（グラス表示 + IMU取得）
```

### フェーズ構成

| フェーズ | 内容 | G2 |
|---|---|---|
| フェーズ1 | Webアプリ単体。音＋ASCIIアニメーション完成 | 不使用 |
| フェーズ2 | G2連携。グラス表示・IMU・リング追加 | 使用 |

---

## 4. フェーズ1 — Webアプリ仕様

### 3-1. 技術スタック

| 役割 | 技術 |
|---|---|
| 音生成 | Tone.js |
| ASCIIアニメーション | Canvas API（または DOM） |
| MIDIブリッジ | Node.js + `easymidi` + `ws`（WebSocket） |
| フレームワーク | Vanilla JS or React |

### 3-2. Node.js ブリッジサーバー

Playtronからのゲームを受け取り、WebSocketで配信する。

```javascript
// bridge.js（Node.js）
const easymidi = require('easymidi')
const WebSocket = require('ws')

const wss = new WebSocket.Server({ port: 8080 })
const input = new easymidi.Input('Playtron') // デバイス名は要確認

input.on('noteon', (msg) => {
  const payload = JSON.stringify({
    type: 'noteon',
    note: msg.note,      // 0-127（MIDIノート番号）
    velocity: msg.velocity,
    channel: msg.channel // どのクリップ（オブジェクト）か
  })
  wss.clients.forEach(client => client.send(payload))
})

input.on('noteoff', (msg) => {
  const payload = JSON.stringify({
    type: 'noteoff',
    note: msg.note,
    channel: msg.channel
  })
  wss.clients.forEach(client => client.send(payload))
})
```

**開発中のテスト用**：Playtronなしでもキーボード（1〜9キー）でMIDIイベントをシミュレートできるモードを用意する。

### 3-3. 音楽設計（Tone.js）

#### スケール設計

```javascript
// ペンタトニックスケール（何を鳴らしても心地よい）
const SCALE = {
  high:   ['E5','G5','A5','B5','D6'],
  mid:    ['A4','B4','D5','E5','G5'],
  low:    ['A3','B3','D4','E4','G4'],
  drone:  ['A2','E3'],
}
```

#### シンセ構成

```javascript
// メインパッド（ゆっくり立ち上がる柔らかい音）
const pad = new Tone.PolySynth(Tone.AMSynth, {
  oscillator: { type: 'sine' },
  envelope: { attack: 2.0, decay: 0.5, sustain: 0.9, release: 5.0 },
  harmonicity: 1.5,
}).connect(reverb)

// ドローン（常に鳴り続ける低音）
const drone = new Tone.Synth({
  oscillator: { type: 'triangle' },
  envelope: { attack: 4.0, decay: 0, sustain: 1.0, release: 8.0 },
}).connect(reverb)

// アルペジオレイヤー（触れている時間が長くなると出現）
const arp = new Tone.PolySynth(Tone.FMSynth, {
  envelope: { attack: 0.5, decay: 0.2, sustain: 0.6, release: 3.0 },
}).connect(reverb)

// エフェクトチェーン
const reverb  = new Tone.Reverb({ decay: 8, wet: 0.75 }).toDestination()
const delay   = new Tone.FeedbackDelay('8n', 0.4).connect(reverb)
const filter  = new Tone.Filter(800, 'lowpass').connect(delay)
const lfo     = new Tone.LFO({ frequency: 0.05, min: 300, max: 900 })
lfo.connect(filter.frequency)
lfo.start()
```

#### タッチ時間による音の展開

| 経過時間 | 変化 |
|---|---|
| タッチ開始 | パッドが1音静かに立ち上がる |
| 3秒 | 同スケール内でランダムに2音目が加わる |
| 6秒 | アルペジオレイヤーが薄く出現 |
| 10秒 | ドローン音が加わり空間が広がる |
| 離す | ゆっくりフェードアウト（release: 5秒） |

#### オブジェクト（ノート番号）による音色の違い

> **実機確認の結果、チャンネルは常に 0 で区別に使えない**ため、当初の「チャンネルで音域を変える」案は **ノート番号ベース**に変更する。

端子ごとに固定のノート番号が割り当たるので、ノート番号（音域帯）で音域・音色を変える。サンプラーではなく**音のキャラクター**を変える。最終的な帯の割り当ては全端子の note 取得後に確定する。

| 区分（ノート番号帯・暫定） | 音域 | 質感 |
|---|---|---|
| 低い note 群 | low / drone | 重厚・地鳴り |
| 中位 note 群 | mid | 中庸・メロディック |
| 高い note 群 | high | スパークル・明るい |

### 3-4. ASCIIアニメーション仕様

#### 基本コンセプト

鳴っているノート名・コード感をASCII文字として画面上でVJビジュアル的に動かす。文字そのものが映像になる。

#### 使用する文字素材

- ノート名: `C D E G A`（ペンタトニック構成音）
- 記号: `░ ▒ ▓ █ · : | / \ —`
- 密度・強度の表現に使う

#### アニメーションパターン

| パターン名 | 発動条件 | 動き |
|---|---|---|
| **インパクト** | タッチ開始 | ノート名が中央から放射状に広がる |
| **リップル** | 触れている間 | 文字が波紋状に広がり消えていく |
| **カスケード** | 3秒経過 | 文字が上から降ってくる（マトリックス風） |
| **ドリフト** | 10秒経過 | 文字がゆっくり漂い画面全体を覆う |
| **フェード** | タッチ終了 | 画面上の文字がゆっくり消えていく |

#### 密度と輝度

- 音が重なるほど文字密度が上がる
- 音量（velocity）が輝度に対応（明→暗のグラデーション）

#### 背景

- 常時: 黒背景にごく薄い文字が漂っている（ゼロ状態でも静止しない）

---

## 5. フェーズ2 — G2連携仕様

### 4-1. 追加する入力軸

| 入力 | 役割 |
|---|---|
| IMU（頭の傾き左右） | リバーブの深さ・空間の広がり |
| IMU（頭の傾き上下） | フィルターの開閉・音の明るさ |
| IMU（向いている方向） | 音の密度・テンポ感 |
| R1リング | 後述 |

### 4-2. IMUとTone.jsの連動

```javascript
// imuData.x → フィルター周波数（頭を右に傾けると音が明るくなる）
const x = imuData.x  // -90 〜 +90
filter.frequency.rampTo(mapRange(x, -90, 90, 200, 2000), 0.5)

// imuData.y → リバーブのwet（頭を上げると空間が広がる）
const y = imuData.y
reverb.wet.rampTo(mapRange(y, -45, 45, 0.4, 0.95), 0.8)
```

### 4-3. G2グラス表示仕様

フェーズ1のブラウザASCIIアニメーションをG2の制約に合わせて再設計する。

#### コンテナ構成

```
createStartUpPageContainer:
  - textContainer (containerID: 1, containerName: 'main', isEventCapture: 1)
    → ASCII文字アニメーション（576×288px全面使用）
```

#### 表示内容

- ブラウザ側と同じパターンをG2向けに最適化
- 16階調グリーンの制約をレトロターミナル美学として活用
- テキストのみ（画像コンテナは使用しない）

#### テキスト更新頻度

- `textContainerUpgrade` で100〜200msごとにフレームを更新
- アニメーションとして認識できる速度を実機検証で確認

### 4-4. R1リングの操作仕様

メイン体験中はリングで積極的な操作は不要（音はPlaytronが担う）。そのため**体験のモード制御**に使う。

| 操作 | 機能 |
|---|---|
| **タップ** | 現在の音・ビジュアル状態をラッチ（一時固定）。Playtronから手を離しても状態が持続する |
| **ダブルタップ** | リセット。全音をフェードアウトし、ビジュアルをゼロ状態に戻す |
| **スクロール上** | ビジュアル密度を手動で上げる（音とは独立して映像だけ濃くする） |
| **スクロール下** | ビジュアル密度を手動で下げる（クリーンな状態にする） |

#### ラッチ機能の詳細

タップでラッチをONにすると、Playtronから手を離しても現在鳴っている音とビジュアルが持続する。もう一度タップでラッチOFF（通常モードに戻る）。

```
ラッチOFF（通常）: Playtronに触れている間だけ音が鳴る
ラッチON:         タップした瞬間の状態が持続。両手が完全に自由になる
```

---

## 6. 開発優先順位

### フェーズ1

1. Node.jsブリッジサーバー（WebMIDI → WebSocket）
2. キーボードシミュレーターモード（Playtronなしでのテスト）
3. Tone.js基本構成（スケール・パッド・リバーブ）
4. タッチ時間による音の展開ロジック
5. チャンネル別音色の割り当て
6. ASCIIアニメーション基本実装（インパクト・リップル）
7. 全パターン実装・調整

### フェーズ2

1. Even Hub WebApp として構成（G2 SDK接続）
2. IMU取得・Tone.jsパラメータ連動
3. G2用ASCIIテキスト表示の実装
4. R1リング操作（ラッチ・リセット・密度調整）
5. フェーズ1ブラウザ画面とG2表示の同時動作

---

## 7. 未確定事項

| 項目 | 状況 |
|---|---|
| Playtronのデバイス名（MIDIデバイス名） | ✅ 確定: "Playtron ポート1" / "Playtron ポート2"（2ポート。`/playtron/i` で自動検出・両方購読） |
| G2でのテキスト更新速度の上限 | 実機検証が必要 |
| ラッチ機能のフィードバック表示 | G2上でのON/OFF表示方法を要検討 |
| オブジェクトの識別方法 | ✅ 確定: ch=0 固定・**note 番号で識別**・vel=90 固定。全16端子の note 対応表は順次取得 |
| 音量・各エフェクトパラメータのバランス | 実際に音を出しながら調整 |
