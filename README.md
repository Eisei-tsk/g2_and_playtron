# Conduct

Playtronica Playtron と Even Realities G2 を組み合わせた、触れて音と映像を生み出すアンビエントアートシステム。

果物・金属・水などの導電性オブジェクトに触れると、Tone.js のアンビエントサウンドと ASCII ビジュアルが立ち上がる。演奏スキル不要。チームラボ的な「誰でも心地よく感じられる」インタラクティブサウンドインスタレーション。

> **コンセプト**: 触れることは「演奏」ではなく「介入」。何を触っても不協和にならず（ペンタトニック）、触れている時間で音が展開し、頭の向きで空間の質感が変わる。G2 グラスは装着者だけが見る私的なビジュアル体験。

---

## 特徴

- **触れて鳴らす** — Playtron に繋いだ導電オブジェクトに触れると MIDI Note On → 音とビジュアルが起動
- **不協和にならない** — ペンタトニックスケール。誰が触れても心地よい
- **時間で展開する音** — タッチ時間に応じてパッド → 2音目 → アルペジオ → ドローンと層が増える
- **オブジェクト別の音色** — MIDI チャンネル（どの端子に繋いだか）で音域・質感が変わる
- **ASCII ビジュアル** — 鳴っている音を ASCII 文字の VJ ビジュアルとして表示（ブラウザ全画面 / G2 グラス）
- **頭で操る空間**（フェーズ2）— G2 の IMU で頭の傾き → リバーブ/フィルター、R1 リングでラッチ/リセット/密度調整

---

## システム構成

```
Playtron（USB）
  ↓ MIDI Note On/Off
Node.js ブリッジサーバー（WebMIDI 受信 + WebSocket 配信）
  ↓ WebSocket（JSON: {type, note, velocity, channel}）
ブラウザ / Even Hub WebView（iPhone）
  ├── Tone.js（音生成）
  ├── ASCII アニメーション（全画面）
  └── G2 SDK（グラス表示 + IMU + R1 リング）  ※フェーズ2
```

### フェーズ構成

| フェーズ | 内容 | G2 |
|---|---|---|
| フェーズ1 | Web アプリ単体。音 + ASCII アニメーション | 不使用 |
| フェーズ2 | G2 連携。グラス表示・IMU・R1 リング | 使用 |

---

## 技術スタック

| 役割 | 技術 |
|---|---|
| 音生成 | Tone.js |
| ASCII アニメーション | Canvas API（または DOM） |
| MIDI ブリッジ | Node.js + `easymidi` + `ws`（WebSocket） |
| グラス SDK | `@evenrealities/even_hub_sdk` v0.0.9 |
| パッケージング | `@evenrealities/evenhub-cli` v0.1.11 |
| シミュレーター | `@evenrealities/evenhub-simulator` v0.7.2 |
| フレームワーク | Vanilla JS / React + TypeScript（Vite） |

---

## 操作

### Playtron（メイン入力）

| 操作 | アクション |
|---|---|
| オブジェクトに触れる | Note On → 音とビジュアルが立ち上がる |
| 触れ続ける | 時間経過で音が層を増す（3秒 / 6秒 / 10秒で展開） |
| 離す | ゆっくりフェードアウト |

### R1 リング（フェーズ2・モード制御）

メイン体験中は積極操作は不要（音は Playtron が担う）。リングは体験のモード制御に使う。

| 操作 | 機能 |
|---|---|
| タップ | 現在の音・ビジュアルをラッチ（一時固定）。手を離しても状態が持続 |
| ダブルタップ | リセット（全音フェードアウト・ビジュアルをゼロ状態へ） |
| スクロール上 | ビジュアル密度を上げる（音とは独立） |
| スクロール下 | ビジュアル密度を下げる |

---

## セットアップ

### 前提条件

- Node.js v22+（nodenv 等のバージョンマネージャー推奨）
- Playtronica Playtron（USB 接続。実機テスト時）
- Even Realities G2 + Even Realities App（iPhone）（フェーズ2の実機テスト時）

> `easymidi` は native アドオン（`node-midi`）をビルドするため、ビルドツール（macOS: Xcode Command Line Tools）が必要。

### インストール

```bash
git clone <repository-url>
cd conduct
npm install
```

> `.npmrc` で `min-release-age=7`（公開から7日未満のパッケージを遮断するサプライチェーン対策）を設定。詳細は [SECURITY.md](SECURITY.md) を参照。

### Playtron の MIDI デバイス名を確認

```bash
node -e "console.log(require('easymidi').getInputs())"
```

表示された名前をブリッジサーバーの `new easymidi.Input('...')` に設定する。ノート番号・チャンネルの割り当ては MIDI モニターで実機確認する。

### 開発（フェーズ1）

```bash
npm run bridge   # MIDI ブリッジサーバー起動（Playtron → WebSocket）
npm run dev      # Web アプリ開発サーバー起動
```

> Playtron が無い場合は、キーボード（1〜9 キー）で MIDI イベントをシミュレートできるモードを使う。

### シミュレーター（G2 表示確認）

```bash
evenhub-simulator http://localhost:5173
```

### 実機テスト（フェーズ2 / G2）

```bash
npm run dev
npx evenhub qr --url "http://<local-ip>:5173"  # QR コードを生成
# → Even Realities App（iPhone）で QR を読み込む
```

### ビルド & パッケージング（G2 配布）

```bash
npm run build
npx evenhub pack app.json dist -o conduct.ehpk
```

---

## プロジェクト構成（予定）

> 現時点ではドキュメントのみ。以下は実装時に作成予定のディレクトリ構成。

```
conduct/
├── CLAUDE.md              # 開発ガイド（G2 SDK 汎用 + Playtron/Tone.js 本プロジェクト軸。AI コンテキスト用）
├── README.md
├── SECURITY.md            # セキュリティガイドライン
├── playtron-g2-spec.md    # 仕様書（音・ビジュアル・G2 連携の詳細。仕様の正）
├── app.json               # Even Hub マニフェスト（フェーズ2）
├── bridge/
│   └── bridge.js          # Node.js MIDI ブリッジ（easymidi → WebSocket）+ キーボードシミュレーター
├── src/
│   ├── audio/             # Tone.js 音響エンジン（スケール・シンセ・展開ロジック）
│   ├── visual/            # ASCII アニメーション（インパクト・リップル・カスケード等）
│   ├── ws/                # WebSocket クライアント（ブリッジ受信）
│   └── glasses/           # G2 SDK 接続・IMU・R1 リング（フェーズ2）
└── public/
```

---

## ドキュメント

| ファイル | 内容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | G2 SDK の制約・API + Playtron/MIDI ブリッジ/Tone.js の本プロジェクト固有ガイド。AI コンテキスト引き継ぎ用 |
| [playtron-g2-spec.md](playtron-g2-spec.md) | アプリの詳細仕様（音楽設計・ビジュアル・G2 連携・開発優先順位）。仕様の正 |
| [SECURITY.md](SECURITY.md) | npm サプライチェーン対策、Claude Code セキュリティ設定 |
| [PROGRESS.md](PROGRESS.md) | 開発の進捗・ステップ詳細。README には進捗を書かず、こちらで管理 |

---

## 参考リンク

### Playtron / Playtronica

| リソース | URL |
|---|---|
| 公式ヘルプ | https://help.playtronica.com/ |
| Playtron セットアップ | https://help.playtronica.com/playtron |
| グラウンディングの仕組み | https://help.playtronica.com/grounding |
| 使えるオブジェクト一覧 | https://help.playtronica.com/objects |
| 公式オンラインシンセ | https://synth.playtronica.com/ |
| 製品ページ | https://shop.playtronica.com/products/playtron |

### Even Realities G2

| リソース | URL |
|---|---|
| 公式ドキュメント | https://hub.evenrealities.com/docs/ |
| 開発者コンソール | https://hub.evenrealities.com/hub |
| SDK（npm） | https://www.npmjs.com/package/@evenrealities/even_hub_sdk |
| コミュニティ Discord | https://discord.gg/Y4jHMCU4sv |

### ツール

| リソース | URL |
|---|---|
| MIDI モニター（Morning Star） | https://morningstar.io/midimon |
| Tone.js | https://tonejs.github.io/ |

---

## ライセンス

TBD
