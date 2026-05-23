# Conduct — Even G2 × Playtron 開発ガイド

Playtronica Playtron と Even Realities G2 を組み合わせたアンビエントアートシステム「**Conduct**」の開発ガイド。前半（§0）に本プロジェクト固有の構成（Playtron / MIDI ブリッジ / Tone.js / G2 連携）を、後半（§1〜）に Even G2 グラス向け WebApp 開発の汎用ナレッジ（SDK 制約・API・パッケージング）をまとめる。

> **最終更新: 2026-05-23**（本プロジェクト使用: SDK v0.0.9 / CLI v0.1.11 / Simulator v0.7.2）
> **npm 最新（参考）**: SDK v0.0.10 / CLI v0.1.13 / Simulator v0.7.2 — SDK/CLI のマイナー更新は未検証のため本プロジェクトでは使用中のバージョンを継続
> Even Hub が 2026-04-03 に正式ローンチ。Beta/Pilot フェーズ終了。約50アプリがローンチ時に公開済み。
>
> **情報の信頼順位**: ① SDK 型定義・実際の API 動作 → ② 公式ドキュメント（ハードウェア制約） → ③ コミュニティ実装実績（実機検証済み値） → ④ SDK README テキスト（型定義と矛盾する場合は型を優先）。情報源間で表記ブレがある場合は本ドキュメント内に併記する。

---

## 0. このプロジェクト（Conduct）について

> **アプリ仕様の正は [playtron-g2-spec.md](playtron-g2-spec.md)。** 本セクションはその要約と、G2 SDK 実装に直結する勘所のみ。スケール・エンベロープ・展開タイミング等の詳細パラメータは仕様書を参照すること。

### コンセプト

「**触れることで音と映像の世界が動く**」。Playtronica Playtron に繋いだ導電オブジェクト（果物・金属・水など）に触れると、Tone.js のアンビエント音と ASCII ビジュアルが変化する。演奏スキル不要・不協和にならない（ペンタトニック）・触れている時間で展開する、チームラボ的なインタラクティブサウンドインスタレーション。触れることは「演奏」ではなく「介入」。G2 グラスは装着者だけが見る私的なビジュアル体験。

### システム構成

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

| フェーズ | 内容 | G2 |
|---|---|---|
| フェーズ1 | Web 単体。音 + ASCII アニメーション | 不使用 |
| フェーズ2 | G2 連携。グラス表示・IMU・R1 リング | 使用 |

### 開発の進め方（ワークフロー）

- **ステップごとにブランチを切って進める。** ブランチの作成・**push**・main へのマージは**開発者（ユーザー）が手動で行う**。Claude は**現在のブランチで実装 → コミットまで**を担当する（**push はしない**・ブランチ作成・main へのマージもしない。デフォルトブランチ `main` 上にいる場合はコミット前に確認する）。リモートは `origin`。
- **進捗は [PROGRESS.md](PROGRESS.md) で管理する。** 大きな変更やステップの切り替え時には、作業と同時に PROGRESS.md へ記録する。**README.md には進捗を書かない**（README はコンテンツ概要・検証・URL 用）。
- **フェーズ2（G2 開発）の着手前に SDK のアップデートを調査する。** 釣りゲーム開発時から `@evenrealities/even_hub_sdk` / `evenhub-cli` / `evenhub-simulator` に更新が入っている可能性が高い（本ドキュメント記載は SDK v0.0.9 / CLI v0.1.11 / Simulator v0.7.2 時点、npm 参考最新は SDK v0.0.10 / CLI v0.1.13）。最新版と changelog を確認し、API 変更の有無を踏まえてから実装する。

### Playtron デバイス & MIDI 仕様

| 項目 | 内容 |
|---|---|
| 接続 | USB-A。最大16ノード（各ノード = 独立 MIDI ノート）、グランド端子 2 |
| 信号 | Note On / Note Off のみ。ノード端子とグランドに同時接触で回路が閉じ Note On、離すと Note Off |
| Velocity | 常に **127 固定**（強弱なし） |
| チャンネル | ノード番号に対応（1〜16）= どのオブジェクトに触れたか |
| ノート番号 | ノード位置に対応した固定値。**接続後に実機で要確認** |
| レイテンシ | 実質ゼロ（< 0.001s） |

> **要実機確認**: MIDI デバイス名・ノート/チャンネル割り当ては接続後に確認する（`require('easymidi').getInputs()` / MIDI モニター）。  
> **運用の癖**: 手が乾燥していると反応しにくい / 非導電物（ゴム・プラ・木）は無反応 / **USB を挿してから Chrome を開く順序が重要** / 防水非対応 / ペースメーカー装着者は使用不可。

### Node.js ブリッジサーバー（easymidi + ws）

Playtron の MIDI を受け取り WebSocket で全クライアントへ配信する。`noteon` / `noteoff` を `{type, note, velocity, channel}` の JSON にして送る（実装例は仕様書 §4-2 を参照）。

- `easymidi` は native アドオン（`node-midi`）を node-gyp でビルドする。**`ignore-scripts=true` だと動かない** → SECURITY.md で `min-release-age=7` のみ採用した判断根拠の一つ。
- **キーボードシミュレーターモードを用意する**: Playtron 無しでも `1`〜`9` キーで noteon/noteoff を発火させてテストできるようにする（開発のメイン手段）。
- WebSocket は **localhost 限定**で運用し、外部公開しない（SECURITY.md §2）。

### Tone.js 音響設計（要点）

- **スケール**: ペンタトニック（high / mid / low / drone の音域帯）。何を鳴らしても協和する。
- **シンセ構成**: パッド（PolySynth/AMSynth, 長い attack/release）+ ドローン（Synth/triangle, 常時持続）+ アルペジオ（PolySynth/FMSynth）。`reverb → delay → filter` + LFO のエフェクトチェーン。
- **タッチ時間で展開**: 開始 = 1音 → 3秒で2音目 → 6秒でアルペジオ → 10秒でドローン → 離すとフェードアウト（release 数秒）。
- **チャンネル別音色**: ch1-4 = high/明るい, 5-8 = mid/メロディック, 9-12 = low/重厚, 13-16 = drone/低音持続。音域と質感を変える（サンプラーではなく音のキャラクターを変える）。

### ASCII アニメーション（要点）

鳴っているノート名・コード感を ASCII 文字の VJ ビジュアルとして動かす。文字素材は `C D E G A`（ペンタトニック構成音）+ `░ ▒ ▓ █ · : | / \ —`。パターン: インパクト（タッチ開始・放射）/ リップル（波紋）/ カスケード（3秒・降下）/ ドリフト（10秒・漂流）/ フェード（終了）。音が重なるほど密度↑、velocity が輝度に対応。ゼロ状態でも薄く文字が漂う。

### G2 連携の実装勘所（フェーズ2）

| 軸 | 実装 | 参照 |
|---|---|---|
| ASCII アニメーション | 全画面テキストコンテナ1つ（`isEventCapture: 1`）を `textContainerUpgrade` で **100〜200ms ごと**にフレーム更新。16階調グリーンをレトロターミナル美学として活用。更新速度の上限は実機検証が必要 | §5「初期化と更新の切り替え」 |
| IMU → 音 | `imuControl(true, ImuReportPace.P500)` → `imuData.x` → filter.frequency, `imuData.y` → reverb.wet を `rampTo` で補間 | §5「IMU データの受信」 |
| R1 リング | タップ = ラッチ（状態固定。手を離しても持続）/ ダブルタップ = リセット（ゼロ状態へ）/ スクロール上下 = ビジュアル密度。スクロールは **~300ms デバウンス**。シミュレーターは `sysEvent`・実機は `textEvent` で届くので両対応 | §5「リング / タッチパッドイベント」 |

> グラス表示は**テキストのみ**（画像コンテナ不使用）。コンテナは `main` 1つで完結する設計。

---

## 目次

0. [このプロジェクト（Conduct）について](#0-このプロジェクトconductについて)
1. [開発要項の参照先](#1-開発要項の参照先)
2. [実装できること・アプリの種類](#2-実装できることアプリの種類)
3. [SDK 基本情報](#3-sdk-基本情報)
4. [グラスの制約と工夫](#4-グラスの制約と工夫)
5. [グラス表示の実装パターン](#5-グラス表示の実装パターン)
6. [even-toolkit（UI デザインシステム & コンポーネント）](#6-even-toolkitui-デザインシステム--コンポーネント)
7. [外部 API との連携パターン](#7-外部-api-との連携パターン)
8. [開発環境セットアップ](#8-開発環境セットアップ)
9. [テスト方法](#9-テスト方法)
10. [Even Hub パッケージング & 配布](#10-even-hub-パッケージング--配布)
11. [Vercel デプロイ](#11-vercel-デプロイ)

---

## 1. 開発要項の参照先

| リソース | 場所 |
|---|---|
| **公式ドキュメント（トップ）** | https://hub.evenrealities.com/docs/ |
| 　├ Getting Started | [overview](https://hub.evenrealities.com/docs/getting-started/overview) / [installation](https://hub.evenrealities.com/docs/getting-started/installation) / [first-app](https://hub.evenrealities.com/docs/getting-started/first-app) / [architecture](https://hub.evenrealities.com/docs/getting-started/architecture) |
| 　├ Guides | [page-lifecycle](https://hub.evenrealities.com/docs/guides/page-lifecycle) / [input-events](https://hub.evenrealities.com/docs/guides/input-events) / [display](https://hub.evenrealities.com/docs/guides/display) / [device-apis](https://hub.evenrealities.com/docs/guides/device-apis) / [design-guidelines](https://hub.evenrealities.com/docs/guides/design-guidelines) |
| 　├ Community | [resources](https://hub.evenrealities.com/docs/community/resources) |
| 　└ Reference | [simulator](https://hub.evenrealities.com/docs/reference/simulator) / [packaging](https://hub.evenrealities.com/docs/reference/packaging) / [cli](https://hub.evenrealities.com/docs/reference/cli) |
| **開発者コンソール（ポータル）** | https://hub.evenrealities.com/hub（旧 https://evenhub.evenrealities.com からリダイレクト） |
| **開発者申請フォーム** | https://hub.evenrealities.com/application |
| **デザインガイドライン（Figma）** | [Even Realities - Software Design Guidelines (Public)](https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782&t=r9P3fmZ2C2glMlQ9-1) |
| SDK npm パッケージ | [`@evenrealities/even_hub_sdk`](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)（現在: 0.0.9） |
| シミュレーター npm パッケージ | [`@evenrealities/evenhub-simulator`](https://www.npmjs.com/package/@evenrealities/evenhub-simulator)（現在: 0.7.2） |
| CLI npm パッケージ | [`@evenrealities/evenhub-cli`](https://www.npmjs.com/package/@evenrealities/evenhub-cli)（現在: 0.1.11） |
| SDK の英語 README | `node_modules/@evenrealities/even_hub_sdk/README.md`（中国語版: `README.zh-CN.md`） |
| コミュニティ技術ノート | [even-g2-notes](https://github.com/nickustinov/even-g2-notes) — アーキテクチャ詳細、Unicode グリフテーブル、SDK の癖、エラーコード |
| コミュニティ Discord | https://discord.gg/Y4jHMCU4sv |
| 公式連絡先 | whiskee.chen@evenrealities.com |

> **注意**: SDK ソースは難読化されている。最新 API はインストール後の README を参照すること。

### 参考リポジトリ（サードパーティ実装例）

| リポジトリ | 画像形式 | 特徴 |
|---|---|---|
| [EvenChess](https://github.com/dmyster145/EvenChess) | 1-bit BMP（PNG フォールバックあり） | 最も詳細な BMP 実装 |
| [tesla-even-g2](https://github.com/nickustinov/tesla-even-g2) | PNG（サーバーサイドで生成） | PNG バイト列を `number[]` に変換して送信 |
| [pong-even-g2](https://github.com/nickustinov/pong-even-g2) | PNG（静的アセット） | PNG ファイルを fetch して `number[]` で送信 |
| [snake-even-g2](https://github.com/nickustinov/snake-even-g2) | PNG（静的アセット） | ゲームプレイはテキスト文字。画像は静的 PNG |
| [tetris-even-g2](https://github.com/nickustinov/tetris-even-g2) | — | テトリス。Canvas ベースのゲーム実装。CLI v0.1.11 使用 |
| [even-toolkit](https://github.com/fabioglimb/even-toolkit) | — | コミュニティ製デザインシステム & コンポーネントライブラリ（v1.6.5, 55+ コンポーネント, 191 アイコン） |
| [rdt-even-g2-rddit-client](https://github.com/fuutott/rdt-even-g2-rddit-client) | — | Reddit クライアント。app.json パッケージング、API プロキシの実装例 |
| [weather-even-g2](https://github.com/nickustinov/weather-even-g2) | — | 天気アプリ |
| [tetris-even-g2](https://github.com/nickustinov/tetris-even-g2) | — | テトリス。Canvas ベースのゲーム実装 |
| [EvenSolitaire](https://github.com/dmyster145/EvenSolitaire) | — | ソリティア。カードゲーム実装 |
| [EVEN-G2-Tamagotchi](https://github.com/Morfeussession2/EVEN-G2-Tamagotchi) | — | たまごっち風育成ゲーム |
| [even-dev](https://github.com/BxNxM/even-dev) | — | コミュニティ製マルチアプリ開発環境。20+ アプリを一括管理・切替 |

---

## 2. 実装できること・アプリの種類

### プラットフォームが対応するアプリの種類

> **2026-04-03 正式ローンチ時点の対応状況**

| 種類 | 状態 | 概要 |
|---|---|---|
| **Plugins** | ✅ 現在対応 | グラス体験のバックグラウンドで動くメインのアプリ形態。WebApp として実装 |
| **Dashboard widgets** | 🔜 拡張予定 | グラスのホーム画面に表示されるグランス可能なカード |
| **Dashboard layouts** | 🔜 拡張予定 | ウィジェットや情報のカスタムレイアウト |
| **AI skills / integrations** | 🔜 拡張予定 | グラスの機能を拡張するインテリジェント機能 |

Plugins は HTML/CSS/JavaScript（TypeScript）で構築する Web アプリ。Vite・React・Vanilla JS など好みのフレームワークで開発できる。

### 開発ワークフロー（公式）

```
1. コードを書く     →  通常の Web アプリ（Vite + SDK）
2. ローカルプレビュー →  evenhub-simulator http://localhost:5173
3. 実機テスト       →  QR サイドロード、または開発者ポータルにプライベートビルドをアップロード
4. パッケージング    →  evenhub pack app.json dist -o myapp.ehpk
5. 提出・配布       →  .ehpk を Even Hub にアップロード → ユーザーが OTA でインストール
```

### グラス表示

| 機能 | 概要 |
|---|---|
| **テキスト表示** | 576×288px のキャンバスにテキストを描画 |
| **リスト表示** | 最大20アイテムのリスト（選択操作付き） |
| **画像表示** | 20〜200×20〜100px の画像コンテナ（起動後に `updateImageRawData` で更新） |
| **レイアウト再構築** | `rebuildPageContainer` で別ページに切り替え |

### デバイス操作・情報取得

| 機能 | 概要 |
|---|---|
| **グラス接続状態の監視** | `onDeviceStatusChanged` でリアルタイム検知 |
| **バッテリー / 装着状態** | `DeviceStatus` の `batteryLevel`, `isWearing`, `isCharging`, `isInCase` |
| **ユーザー情報取得** | Even アカウントの UID / 名前 / アバター / 国 |
| **デバイス情報取得** | モデル名 / シリアル番号 |
| **ローカルストレージ** | `setLocalStorage` / `getLocalStorage`（App 側で永続化） |

### 入力・操作

| 機能 | 概要 |
|---|---|
| **G2 タッチパッド** | プレス / ダブルプレス / スワイプ上 / スワイプ下（`EventSourceType` で G2/R1 を区別可能） |
| **R1 リング操作** | プレス / ダブルプレス / スワイプ上 / スワイプ下（G2 と同じジェスチャー、ソースで区別） |
| **リスト選択** | `listEvent.currentSelectItemName` / `currentSelectItemIndex` |
| **マイク入力** | PCM オーディオストリームをリアルタイム受信（16kHz, signed 16-bit LE, mono）。`event.audioEvent.audioPcm` は `Uint8Array` |
| **IMU（加速度/ジャイロ）** | `imuControl(isOpen, reportFrq)` で有効化し、`sysEvent.imuData` で x/y/z を受信 |
| **起動元検知** | `onLaunchSource(callback)` でアプリメニュー / グラスメニューからの起動を判別 |
| **アプリ終了制御** | `shutDownPageContainer` で即時終了 or 確認ダイアログ |

---

## 3. SDK 基本情報

### インストール

```bash
npm install @evenrealities/even_hub_sdk           # SDK（現在: 0.0.9）
npm install -D @evenrealities/evenhub-cli         # CLI（現在: 0.1.11）
npm install -g @evenrealities/evenhub-simulator   # シミュレーター（現在: 0.7.2）
```

### バージョン管理

```json
{
  "dependencies": {
    "@evenrealities/even_hub_sdk": "^0.0.9"
  },
  "devDependencies": {
    "@evenrealities/evenhub-cli": "^0.1.11"
  }
}
```

> SDK はマイナーバージョンアップで API が変わることがある。インストール後に README を必ず確認する。

### バージョン履歴（npm 公開日）

| パッケージ | バージョン | 公開日 | 主な変更 |
|---|---|---|---|
| **SDK** | 0.0.7 | 2026-02-11 | — |
| | 0.0.8 | 2026-03-25 | launch source 検知、IMU 制御、`borderRadius` 修正、コンテナ上限 4→12 に拡張、画像最大 288×144（README 記載値） |
| | **0.0.9** | **2026-03-25** | `EventSourceType` 互換性改善、デフォルト source enum フォールバック |
| **CLI** | 0.1.9 | 2026-03-21 | app.json サイズ制限調整 |
| | 0.1.10 | 2026-03-24 | app.json 制約微調整（公式ドキュメント記載バージョン） |
| | **0.1.11** | **2026-03-25** | 最新（npm 実態。公式ドキュメントは v0.1.10 のまま未更新） |
| **Simulator** | 0.5.0 | 2026-02-27 | スクリーンショット機能追加 |
| | 0.5.2 | 2026-02-28 | 4-bit カラーレンダリング |
| | 0.6.0 | 2026-03-25 | SDK 0.0.8 変更に追従 |
| | 0.6.2 | 2026-03-25 | コンテナ制限をファームウェアと同期 |
| | **0.7.2** | **2026-04 頃** | 最新（変更詳細は未調査） |

> **⚠️ 表記ブレ**: 公式ドキュメント（最終更新 2026-03-27 頃）では CLI v0.1.10 と記載されているが、npm の最新は v0.1.11。本ドキュメントでは npm 実態（v0.1.11）を正とする。

### 主要エクスポート一覧

```typescript
import {
  waitForEvenAppBridge,
  EvenAppBridge,
  // ページ構築
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
  TextContainerUpgrade,
  ImageRawDataUpdate,
  // イベント・列挙型
  OsEventTypeList,
  DeviceConnectType,
  ImuReportPace,
  EventSourceType,
  StartUpPageCreateResult,
  EvenAppMethod,
  LAUNCH_SOURCE_APP_MENU,
  LAUNCH_SOURCE_GLASSES_MENU,
  // データモデル
  EvenHubEvent,
  DeviceStatus,
  DeviceInfo,
  DeviceModel,
  UserInfo,
  IMU_Report_Data,
} from '@evenrealities/even_hub_sdk'
```

### EvenAppBridge の主要メソッド

| メソッド | 説明 |
|---|---|
| `createStartUpPageContainer(...)` | グラス UI の初期化（**1回だけ呼ぶ**） |
| `rebuildPageContainer(...)` | ページの再構築（2回目以降のレイアウト変更） |
| `textContainerUpgrade(TextContainerUpgrade)` | テキスト内容の更新（フリッカーなし）。**オブジェクト形式**（下記注参照） |
| `updateImageRawData(ImageRawDataUpdate)` | 画像データの更新。`imageData` は `number[] \| string \| Uint8Array \| ArrayBuffer` に対応 |
| `audioControl(isOpen)` | マイクの ON/OFF |
| `imuControl(isOpen, reportFrq?)` | IMU の ON/OFF。`ImuReportPace.P100`〜`P1000` で間隔指定 |
| `shutDownPageContainer(exitMode?)` | アプリ終了 |
| `onEvenHubEvent(callback)` | グラスイベントの購読（戻り値が unsubscribe 関数） |
| `onDeviceStatusChanged(callback)` | デバイス状態変化の購読 |
| `onLaunchSource(callback)` | 起動元の検知 |
| `getUserInfo()` | Even アカウント情報の取得 |
| `getDeviceInfo()` | デバイス情報の取得（`DeviceInfo` には `isGlasses()` / `isRing()` メソッドあり） |
| `setLocalStorage(key, value)` | App 側永続ストレージへの書き込み |
| `getLocalStorage(key)` | App 側永続ストレージからの読み込み |

### ⚠️ API シグネチャの表記ブレ

| メソッド | SDK 型定義（v0.0.9）= 正 | 公式ドキュメント | 備考 |
|---|---|---|---|
| `textContainerUpgrade` | **オブジェクト形式** `bridge.textContainerUpgrade(new TextContainerUpgrade({containerID, containerName, content, contentOffset?, contentLength?}))` | 位置引数形式 `bridge.textContainerUpgrade(id, name, content, offset, length)` | 全コミュニティ実装がオブジェクト形式を使用。公式ドキュメントの記載は古い可能性が高い |
| `createStartUpPageContainer` | **オブジェクト形式** `bridge.createStartUpPageContainer(new CreateStartUpPageContainer({containerTotalNum, textObject?, listObject?, imageObject?}))` | 位置引数形式 `bridge.createStartUpPageContainer(1, [textContainer])` | 公式 first-app ページでは位置引数形式。SDK が内部で `toJson()` 変換するため両方動作する可能性があるが、**型安全のためオブジェクト形式を推奨** |

> **実装時は SDK の型定義に従いオブジェクト形式を使うこと。** 公式ドキュメントの位置引数形式は SDK v0.0.9 の TypeScript 型定義と一致しない。全コミュニティ実装もオブジェクト形式で統一されている。
>
> **公式ドキュメントの最終更新は 2026-03-27 頃**。SDK v0.0.8/v0.0.9 のリリース（2026-03-25）以降にドキュメントが完全に追従していない可能性がある。

---

## 4. グラスの制約と工夫

### キャンバス仕様

| 項目 | 値 |
|---|---|
| 解像度 | 576 × 288 px（片目あたり） |
| 色深度 | **4-bit グレースケール（16 階調の緑）**。白ピクセル = 明るい緑、黒 = 消灯/透明 |
| 座標原点 | 左上 (0, 0) |
| X軸 | 右方向が正 |
| Y軸 | 下方向が正 |
| フォント | LVGL ファームウェア内蔵フォント。**等幅ではない**。サイズ・太さ・フォント種類の変更不可 |
| テキスト配置 | 左揃え・上揃えのみ。中央揃えはスペースで手動パディング |

### コンテナの制約

| 制約 | 内容 |
|---|---|
| 最大コンテナ数 | **画像コンテナ最大4、その他（テキスト/リスト）最大8**（合計最大12） |
| イベント受信 | **1ページにつき1コンテナのみ** `isEventCapture: 1` |
| `containerName` | **最大16文字**、ページ内でユニーク |
| `containerID` | ページ内でユニーク |
| `createStartUpPageContainer` | **初回のみ有効**。2回目以降は `rebuildPageContainer` を使う |
| 画像コンテナ | 起動時にはデータを渡せない。作成後に `updateImageRawData` を呼んでから表示 |
| コンテナ重ね合わせ | 後から宣言したコンテナが前面に描画される（z-index 制御は宣言順のみ） |

> **⚠️ 表記ブレ**: even-g2-notes では「max 4 containers per page」と記載があるが、これは SDK v0.0.8 以前の制約。v0.0.8 Changelog で「Expanded startup container creation from 4 to 12」と拡張済み。SDK/公式ドキュメントの **合計12（画像4 + テキスト/リスト8）** が正。

### コンテナ共通プロパティ範囲（SDK 型定義より）

| プロパティ | テキスト | リスト | 画像 |
|---|---|---|---|
| `xPosition` | 0–576 | 0–576 | 0–576 |
| `yPosition` | 0–288 | 0–288 | 0–288 |
| `width` | 0–576 | 0–576 | 20–200 ※ |
| `height` | 0–288 | 0–288 | 20–100 ※ |
| `borderWidth` | 0–5 | 0–5 | — |
| `borderColor` | 0–15（テキスト: 0–16） | 0–15 | — |
| `borderRadius` | 0–10 | 0–10 | — |
| `paddingLength` | 0–32 | 0–32 | — |

> ※ 画像コンテナの width/height は SDK README では 20–288 / 20–144 と記載されているが、ファームウェア実制約は 20–200 / 20–100。詳細は「画像コンテナのサイズ制約」を参照。

### テキスト制約

| 操作 | 最大文字数 |
|---|---|
| `createStartUpPageContainer` | 1,000文字（起動時は転送効率のためなるべく短く） |
| `textContainerUpgrade` | 2,000文字 |
| `rebuildPageContainer` | 1,000文字 |

### 画像コンテナのサイズ制約

| 項目 | 実装推奨値 | SDK README 記載値 | 公式ドキュメント記載値 |
|---|---|---|---|
| width | **20〜200 px** | 20〜288 | 20〜200 |
| height | **20〜100 px** | 20〜144 | 20〜100 |

> **⚠️ 表記ブレあり**: SDK README (v0.0.9) は width: 20-288 / height: 20-144 と記載しているが、公式ドキュメント ([display](https://hub.evenrealities.com/docs/guides/display)) は **20-200 × 20-100** と明記。コミュニティ全実装（EvenChess, snake, pong, tesla, tetris, even-toolkit）も **200×100** で統一。EvenChess のソースコメントに「G2 firmware hard-caps image containers at 200x100 regardless of byte size or format」とあり、**ファームウェア側の実制約は 200×100**。
>
> **結論**: 実装時は **200×100 以内** に収めること。SDK README の 288×144 はドキュメント上の誤記と判断する。

### リスト制約

| 項目 | 制約 |
|---|---|
| 最大アイテム数 | **20** |
| アイテムあたり最大文字数 | **64文字** |
| スクロール | ファームウェアがネイティブ処理 |
| 更新 | **リスト単体の更新不可**。`rebuildPageContainer` でページ全体を再構築 |

### 戻り値・エラーコード

| メソッド | 戻り値の型 | 値 |
|---|---|---|
| `createStartUpPageContainer` | `StartUpPageCreateResult` | 0=Success, 1=Invalid, 2=Oversize, 3=OutOfMemory |
| `rebuildPageContainer` | `boolean` | true=成功, false=失敗 |
| `textContainerUpgrade` | `boolean` | true=成功, false=失敗 |
| `updateImageRawData` | `ImageRawDataUpdateResult` | `success`, `imageException`, `imageSizeInvalid`, `imageToGray4Failed`, `sendFailed` |
| `shutDownPageContainer` | `boolean` | true=成功, false=失敗 |
| `audioControl` | `boolean` | true=成功, false=失敗 |
| `imuControl` | `boolean` | true=成功, false=失敗 |

### 利用可能な Unicode 文字

| 用途 | 文字 |
|---|---|
| プログレスバー | `━ ─ █▇▆▅▄▃▂▁` |
| ナビゲーション矢印 | `▲△▶▷▼▽◀◁` ← → ↑ ↓ ↔ ⇒ ⇔ |
| 選択・状態 | `●○ ■□ ★☆ ◆◇` |
| ボックス罫線（丸角対応） | `╭╮╯╰ │─ ┌┐└┘ ├┤┬┴┼` |
| カードスーツ | `♠♣♥♦` |
| 上付き・下付き数字 | `⁰¹²³⁴⁵⁶⁷⁸⁹` / `₀₁₂₃₄₅₆₇₈₉` |
| 分数 | `¼ ½ ⅛` |
| 記号 | `© ® ™ † ‡ ° ∞` |

> **使用不可**: 絵文字（U+1F300+）、天気記号、雪の結晶、水滴、ディンバット（U+2700+）は全て非対応。フォント外の文字は**無音でスキップ**される。

### UI パターン（公式ドキュメントより）

| パターン | 実装方法 |
|---|---|
| 疑似ボタン | テキストの先頭に `>` をカーソルとして付与 |
| 選択ハイライト | 個別テキストコンテナの `borderWidth` を切り替え |
| 複数行レイアウト | テキストコンテナを縦に複数配置 |
| プログレスバー | Unicode ブロック文字: `━`（完了）と `─`（未完了） |
| ページ送り | ~400-500 文字で事前分割、スクロールイベントで切替 |
| 画像ベースアプリ | 全画面テキストコンテナ（`content: ' '`, `isEventCapture: 1`）を背面に配置し、画像コンテナを前面に重ねる |

### SDK の既知の癖

| 癖 | 対処 |
|---|---|
| `CLICK_EVENT`（値 0）が `undefined` になる場合がある | SDK の `fromJson` が `0` を `undefined` に変換する。`type === OsEventTypeList.CLICK_EVENT \|\| type === undefined` で両方ハンドリング |
| リストの最初のアイテムの index が欠落する場合がある | シミュレーター（場合により実機でも）で index 0 が省略される。`undefined` の場合は 0 として扱い、アプリ側で選択状態を追跡する |
| スクロールイベント（SCROLL_TOP/BOTTOM）が連発する | **~300ms のデバウンス**が必要 |
| シミュレーターと実機で挙動が異なる | フォント描画、リストスクロール、画像処理等で差異あり |
| シミュレーターのイベント送信元が異なる | シミュレーターはボタンクリックを `sysEvent` で送信するが、実機は `textEvent` / `listEvent` で送信する。3つ全てをハンドリングすること |
| `rebuildPageContainer` で状態がリセットされる | リスト選択位置・スクロール位置が失われる。可能なら `textContainerUpgrade` で差分更新する |
| 隠し 1×1 リストコンテナはスクロール取得に使えない | イベントキャプチャには全画面テキストコンテナ（`content: ' '`, `isEventCapture: 1`）を使う |

### 工夫・ベストプラクティス

- **テキストは改行区切りで構造化する**

  ```typescript
  const DIVIDER = '----------------------------------------'
  return [
    trackName,
    artistName,
    `${elapsed} / ${total}`,
    DIVIDER,
    '[ > Playing ]  Shuffle: ON',
    DIVIDER,
    'Click: Play/Pause   Dbl: Next',
  ].join('\n')
  ```

- **画像送信はキューイングする**  
  `updateImageRawData` は前の送信が完了するまで次を送らないこと（並列禁止）。

- **1-bit BMP の行ストライドは `Math.ceil(Math.ceil(width/8)/4)*4`**

  ```typescript
  // ❌ 誤り（width=200 → 100 bytes/行）
  const rowSize = Math.ceil(width / 8) * 4
  // ✅ 正しい（width=200 → 28 bytes/行）
  const rowSize = Math.ceil(Math.ceil(width / 8) / 4) * 4
  ```

- **PNG もそのまま送信できる**  
  `canvas.toBlob('image/png')` → `ArrayBuffer` → `number[]` の流れで実装可能。ハードウェアは16階調対応なので PNG（グレースケール）推奨。BMP は同期処理でアニメーションループに向く。

- **`imageData` は複数の型に対応**（SDK v0.0.9）  
  `number[]`（推奨）、`Uint8Array`、`ArrayBuffer`、base64 `string` のいずれも可。SDK が内部で `number[]` に変換する。

- **手動ディザリングは避ける**  
  ホストアプリの `imageToGray4` 処理が4-bitダウンサンプリングを行うため、手動の Floyd-Steinberg ディザリングはノイジーな緑ドットの原因になる（even-g2-notes より）。

- **画像サイズとコンテナサイズを一致させる**  
  画像データがコンテナより小さい場合、ファームウェアはタイリング（繰り返し表示）する。必ず画像サイズ = コンテナサイズにすること。

- **`seededRandom` に非16進文字列を渡すと NaN になる**  
  シード文字列は FNV-1a 等のハッシュ関数で数値化してから使う。

---

## 5. グラス表示の実装パターン

### ライフサイクル

```
アプリ起動
  │
  ▼
waitForEvenAppBridge()
  │
  ▼
onLaunchSource(callback)      ← 起動元を検知（1回だけプッシュ）
  │
  ▼
createStartUpPageContainer()  ← 必ず1回だけ
  │
  ▼（以降はループ）
textContainerUpgrade()        ← テキスト内容の差分更新（フリッカーなし）
  または
rebuildPageContainer()        ← レイアウト自体を変えたい場合
```

### 基本接続パターン（React）

```typescript
const [bridge, setBridge] = useState<EvenAppBridge | null>(null)

useEffect(() => {
  waitForEvenAppBridge()
    .then((b) => setBridge(b))
    .catch(() => { /* グラス未接続 or Even Hub 外 */ })
}, [])
```

### 起動元の検知

```typescript
// WebView ロード完了時に1回だけプッシュされる。早めに登録すること
const unsubscribe = bridge.onLaunchSource((source) => {
  // source: 'appMenu' | 'glassesMenu'
  if (source === 'glassesMenu') {
    // グラスメニューから起動された場合の処理
  }
})
```

### 初期化と更新の切り替え（useRef で管理）

```typescript
const isInitialized = useRef(false)

useEffect(() => {
  if (!bridge || !data) return

  if (!isInitialized.current) {
    isInitialized.current = true
    bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            xPosition: 0, yPosition: 0,
            width: 576, height: 288,
            borderWidth: 0, borderColor: 0,
            paddingLength: 8,
            containerID: 1,
            containerName: 'main',        // 16文字以内
            content: buildContent(data),  // 1000文字以内
            isEventCapture: 1,
          }),
        ],
      })
    )
  } else {
    // ⚠️ オブジェクト形式で呼ぶこと（位置引数形式は SDK v0.0.9 では型エラー）
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'main',
        contentOffset: 0,
        contentLength: 2000,
        content: buildContent(data),  // 2000文字以内
      })
    )
  }
}, [bridge, data])
```

> **ポイント**: `isInitialized` は `useRef` で管理。`useState` にすると再レンダリングで `createStartUpPageContainer` が二重に呼ばれる恐れがある。

### イベントタイプ一覧

| イベント | 値 | 説明 |
|---|---|---|
| `CLICK_EVENT` | 0 | シングルプレス |
| `SCROLL_TOP_EVENT` | 1 | スワイプ上 / スクロール上端到達 |
| `SCROLL_BOTTOM_EVENT` | 2 | スワイプ下 / スクロール下端到達 |
| `DOUBLE_CLICK_EVENT` | 3 | ダブルプレス |
| `FOREGROUND_ENTER_EVENT` | 4 | アプリがフォアグラウンドに復帰 |
| `FOREGROUND_EXIT_EVENT` | 5 | アプリがバックグラウンドへ |
| `ABNORMAL_EXIT_EVENT` | 6 | Bluetooth 切断等の異常終了 |
| `SYSTEM_EXIT_EVENT` | — | システム終了イベント |
| `IMU_DATA_REPORT` | — | IMU データプッシュ |

### イベントルーティング

| キャプチャコンテナの種類 | イベントの届き先 |
|---|---|
| テキストコンテナ | `event.textEvent` |
| リストコンテナ | `event.listEvent` |

### リング / タッチパッドイベントの受信

```typescript
useEffect(() => {
  if (!bridge) return

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    const type = event?.textEvent?.eventType ?? event?.sysEvent?.eventType

    switch (type) {
      case OsEventTypeList.CLICK_EVENT:
      case undefined:  // SDK が値 0 を undefined に変換する場合がある
        break
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        break
      case OsEventTypeList.FOREGROUND_ENTER_EVENT:
        // タイマー再開、データ再取得等
        break
      case OsEventTypeList.FOREGROUND_EXIT_EVENT:
        // タイマー停止、リソース解放等
        break
    }
  })

  return unsubscribe
}, [bridge])
```

> スクロールイベントは連発するため **~300ms のデバウンス**が必要。

### IMU データの受信

```typescript
await bridge.imuControl(true, ImuReportPace.P500)

const unsubscribe = bridge.onEvenHubEvent((event) => {
  const sys = event.sysEvent
  if (!sys?.imuData) return
  if (sys.eventType !== OsEventTypeList.IMU_DATA_REPORT) return
  const { x, y, z } = sys.imuData
})
```

---

## 6. even-toolkit（UI デザインシステム & コンポーネント）

[even-toolkit](https://github.com/fabioglimb/even-toolkit) は Even G2 アプリ向けのコミュニティ製デザインシステム & コンポーネントライブラリ。

> **⚠️ コミュニティ製パッケージ**（Even Realities 公式ではない）。作者: fabioglimb。非常に活発に開発中（3週間で30バージョン）。

### インストール

```bash
npm install even-toolkit
npx even-toolkit my-app  # スキャフォールディング（6テンプレート: minimal, dashboard, notes, chat, tracker, media）
```

**現在のバージョン:** 1.6.5（2026-04-05 公開）

**Peer dependencies:**
- `@evenrealities/even_hub_sdk` >= 0.0.9
- `@jappyjan/even-better-sdk` >= 0.0.11（代替 SDK ラッパー。ページ構成・部分テキスト更新の高レベル API を提供）
- `react` >= 18.0.0, `react-router` >= 7.0.0
- `class-variance-authority`, `clsx`, `tailwind-merge`

### モジュール構成

| モジュール | インポート | 概要 |
|---|---|---|
| **Web UI** | `even-toolkit/web` | 55+ React コンポーネント（Button, Card, NavBar, Toggle, AppShell, DrawerShell, Dialog, Toast, Charts, Calendar 等）+ 191 ピクセルアートアイコン（32×32, 6カテゴリ）+ デザイントークン |
| **Glasses SDK** | `even-toolkit/glasses` | スクリーンベースのグラス表示アーキテクチャ（v1.4〜）。スクリーンルーター、ディスプレイビルダー、ナビゲーションヘルパー |
| **Speech-to-Text** | `even-toolkit/stt` | Soniox プロバイダー（ストリーミング対応） |

### Web UI デザインルール（主要トークン）

| トークン | 値 | 用途 |
|---|---|---|
| `--color-text` | #232323 | プライマリテキスト |
| `--color-bg` | #EEEEEE | ページ背景 |
| `--color-surface` | #FFFFFF | カード / コンポーネント背景 |
| `--color-accent` | #232323 | プライマリハイライト |
| `--radius-default` | 6px | **すべての矩形要素に統一** |

> `font-bold` / `font-semibold` は使用禁止。ウェイトは 400（normal）と 300（light）のみ。（Even Realities 2025 UIUX Guidelines 準拠。ライト/ダークテーマ対応。）

### ライブデモ（even-toolkit 製）

| デモ | 概要 |
|---|---|
| even-demo | 基本コンポーネントデモ |
| even-market | マーケット UI |
| even-kitchen | キッチンタイマー |
| even-workout | ワークアウトトラッカー |
| even-browser | ブラウザ |

> いずれも Vercel でホスト。even-toolkit の GitHub リポジトリからリンクあり。

---

## 7. 外部 API との連携パターン

### ポーリングによる状態同期

```typescript
const POLLING_INTERVAL = 5000

useEffect(() => {
  if (!isReady) return
  fetchData()
  const timer = setInterval(fetchData, POLLING_INTERVAL)
  return () => clearInterval(timer)
}, [isReady])

useEffect(() => {
  if (!isReady) return
  const onVisible = () => { if (!document.hidden) fetchData() }
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
}, [isReady])
```

### 楽観的 UI 更新

```typescript
function handleAction() {
  setData((prev) => prev ? { ...prev, isActive: !prev.isActive } : prev)
  callExternalApi().then(() => setTimeout(fetchData, 500))
}
```

---

## 8. 開発環境セットアップ

### 推奨スタック

| ツール | バージョン |
|---|---|
| Node.js | v18+（公式ドキュメント）/ `^20.0.0 \|\| >=22.0.0`（SDK package.json） |
| TypeScript | `~5.9` |
| Vite | `^8` |

### プロジェクト作成

```bash
# React あり
npm create vite@latest my-even-app -- --template react-ts
cd my-even-app
npm install @evenrealities/even_hub_sdk
npm install -D @evenrealities/evenhub-cli

# Vanilla TS
npm create vite@latest my-even-app -- --template vanilla-ts
```

---

## 9. テスト方法

### シミュレーター（ハードウェア不要）

```bash
npm install -g @evenrealities/evenhub-simulator
evenhub-simulator http://localhost:5173
```

> シミュレーターは **Rust 製ネイティブバイナリ**（内部で lvgl-sys v9 を使用しレンダリング）。プラットフォーム別バイナリが npm 経由で配布される。

**主要オプション:**

| オプション | 説明 |
|---|---|
| `-g / --glow` | グロー効果 ON |
| `--no-glow` | グロー効果 OFF |
| `-b / --bounce <type>` | `default` or `spring` アニメーション |
| `--list-audio-input-devices` | 利用可能なオーディオ入力デバイス一覧 |
| `--aid <device>` | オーディオ入力デバイス指定 |
| `--print-config-path` | 設定ファイルパス表示 |
| `--completions <shell>` | シェル補完生成（bash / zsh / fish / elvish / powershell） |
| `-c / --config <path>` | 設定ファイル指定 |

**スクリーンショット（v0.5.0+）:** RGBA PNG をカレントディレクトリにタイムスタンプ付きファイル名で出力。`--glow` フラグの影響を受けない。

**オーディオ仕様:** 16,000 Hz, signed 16-bit LE PCM, 100ms/イベント（3,200 bytes / 1,600 samples）

**シミュレーターの制約:**
- フォント描画・リストスクロール・画像処理でハードウェアと差異あり
- **画像サイズ制限が適用されない**（実機では 200×100 でハードキャップ）
- ステータスイベントは送出されない（ハードコードされたプロファイルを使用）
- 対応イベント: Up, Down, Click, Double Click のみ
- **イベント送信元が実機と異なる**: シミュレーターは `sysEvent` で送信、実機は `textEvent` / `listEvent` で送信

### 実機テスト（Even Hub アプリ経由）

```bash
npm run dev
npx evenhub qr   # ローカル IP を自動検出、ポート入力
```

Even Hub アプリ（iPhone）で QR を読み込むと WebView が開いてグラスに表示される。

---

## 10. Even Hub パッケージング & 配布

> **Even Hub は 2026-04-03 に正式ローンチ。** 約50アプリが公開、2,000+ の開発者がネットワークに参加。

### 10-1. 配布フロー（全体像）

```
開発                テスト                  パッケージング          公開
────                ────                  ──────────          ────
Vite ローカル開発  → シミュレーター確認     → npm run build      → .ehpk をポータルにアップロード
                  → QR サイドロード(実機)  → evenhub pack       → レビュー（基準・期間は非公開）
                  → Private Build(実機)     → .ehpk 生成       → Even Hub マーケットプレイスで公開
                                                               → ユーザーが OTA でインストール
```

### 10-2. 開発者登録（必須）

アプリを公開するには **開発者申請** が必要。

| 項目 | 内容 |
|---|---|
| 申請先 | https://hub.evenrealities.com/application |
| 提出内容 | 背景・プロジェクト案・可用性・ポートフォリオリンク |
| 審査 | Even Realities がアプリの G2 適合性を審査（低摩擦・glanceable な体験に合うか） |
| Pilot Program | 早期アクセスコホート。プラットフォームチームからの直接フィードバックあり |

> **開発・テスト自体は登録前でも可能。** シミュレーター、QR サイドロード、ローカル開発は開発者登録なしで行える。

### 10-3. テスト方法（3段階）

| 方法 | 用途 | 要件 |
|---|---|---|
| **1. シミュレーター** | レイアウト確認・ロジックテスト | PC のみ。実機不要 |
| **2. QR サイドロード** | 実機での動作確認（**ホットリロード対応**） | G2 + iPhone + 同一 Wi-Fi |
| **3. Private Build** | .ehpk をポータルにアップロードし、自分のデバイスでのみテスト | 開発者登録 + .ehpk |

```bash
# QR サイドロード（開発中のメイン手法。以前と同じ方法で引き続き使用可能）
npm run dev
npx evenhub qr --url "http://192.168.x.x:5173"  # ローカル IP を指定（localhost は不可）
# → Even Realities アプリ（iPhone）で QR を読み込む → グラスに表示
```

> **Private Build** は「ステージング」に相当する機能。.ehpk をポータルにアップロードし、公開せずに自分のデバイスでテストできる。ただし、**招待制ベータ配布**（特定ユーザーへの限定公開）が可能かどうかは公式に文書化されていない。

### 10-4. ポータル（開発者コンソール）

| 項目 | 内容 |
|---|---|
| URL | https://hub.evenrealities.com/hub（旧 evenhub.evenrealities.com からリダイレクト） |
| 技術 | Nuxt.js SPA（認証が必要な管理画面） |
| 対応デバイス | **PC 専用ではない。** デスクトップ・タブレット・モバイルレイアウト対応 |
| 対応言語 | English (en-US) / 简体中文 (zh-CN) |
| 主な機能 | Console（アプリ管理）、Documentation リンク、Community リンク |
| 認証 | `evenhub login` で取得したアカウント（email / accessToken） |

> **⚠️ ポータル内部の UI（アップロードフォーム、アプリ管理画面等）は認証後のみアクセス可能。** 公式ドキュメントにはポータルの操作手順の詳細は記載されていない。

### 10-5. アプリのホスティング

| 配布方法 | ホスティング | 備考 |
|---|---|---|
| **Even Hub 配布（推奨）** | **Even Hub Cloud がホスティング** | .ehpk に全アセットがバンドルされる。**Vercel 等の外部ホスティングは不要** |
| **PWA 配布（代替）** | 自前ホスティング（Vercel 等）が必要 | Even Hub のレビュー・パッケージングを経由しない。プライベート配布向け |
| **外部 API バックエンド** | 別途ホスティングが必要 | アプリが外部 API を呼ぶ場合、そのサーバーは自前でホスト |

> **Vercel の位置づけ**: Even Hub 正式ローンチ前は Vercel にデプロイして QR で読み込む開発スタイルが主流だったが、正式ローンチ後は **Even Hub 配布なら Vercel は不要**。ただし以下の場合は引き続き有用:
> - PWA として Even Hub 外で配布する場合
> - 開発中の Web UI（ブラウザ全画面の ASCII ビジュアル等）を PC ブラウザで確認する場合
> - 外部 API のバックエンドをホストする場合

### 10-6. ユーザーへの配布（OTA）

```
Even Hub Cloud → ユーザーの iPhone（Even Realities アプリ内の専用タブ）
             → アプリをブラウズ & インストール（OTA、数秒で完了）
             → インストール後は G2 グラスメニューから直接起動可能
```

- アプリロジックは **iPhone 上の WebView** で実行される
- グラスは **表示レンダリングとネイティブスクロール処理** のみ担当
- ユーザーは R1 リング or テンプルタッチパッドで操作

### 10-7. 公開に必要なアセット

#### app.json マニフェスト（.ehpk に含まれる）

```bash
npx evenhub init  # テンプレート生成
```

```json
{
  "package_id": "com.example.g2demo",
  "edition": "202601",
  "name": "G2 Demo",
  "version": "0.1.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.7",
  "entrypoint": "index.html",
  "permissions": [
    {
      "name": "network",
      "desc": "API通信に必要",
      "whitelist": ["https://example.com"]
    }
  ],
  "supported_languages": ["en", "ja"]
}
```

> 一部のソースでは `app.json` に `tagline`, `description`, `author` フィールドも記載されているが、公式ドキュメントのスキーマには含まれていない。ポータルのアップロードフォームで別途入力する可能性がある。

#### ストアアセット（ポータルで別途提供と推測）

> **⚠️ 以下は公式に文書化されていない。** ポータルの認証後画面でのみ確認可能。

| アセット | 推測される要件 | 根拠 |
|---|---|---|
| アプリアイコン | 必要と推測（サイズ・形式は不明） | マーケットプレイス上でアイコン表示あり |
| スクリーンショット | 必要と推測 | ストアページに表示される |
| 説明文 / タグライン | 必要と推測 | ストアページに表示される |
| カテゴリ | 必要と推測 | マーケットプレイスのカテゴリ分けあり |

> **確認方法**: 開発者登録後にポータル（https://hub.evenrealities.com/hub）にログインし、アプリ提出フォームで必要なアセットを確認すること。

### 10-8. レビュープロセス

| 項目 | 内容 |
|---|---|
| レビューの有無 | **あり**（公式 Architecture ページに「Even Hub's packaging and review process」と記載） |
| レビュー基準 | **非公開**。G2 の「低摩擦・glanceable」な体験への適合性が求められる |
| 承認期間 | **非公開** |
| CLI からの直接サブミット | **不可**。CLI には `submit` / `publish` コマンドはない。ポータルからアップロード |
| バージョン更新フロー | **未文書化** |
| 収益モデル・課金 | **非公開** |

### フィールドルール

| フィールド | 必須 | ルール |
|---|---|---|
| `package_id` | Yes | 逆ドメイン形式。各セグメントは小文字英字始まり・小文字英数のみ。ハイフン不可。最低2セグメント |
| `edition` | Yes | `"202601"` 固定 |
| `name` | Yes | **20文字以内** |
| `version` | Yes | semver: `x.y.z` |
| `min_app_version` | Yes | 例: `"2.0.0"` |
| `min_sdk_version` | Yes | 例: `"0.0.7"` |
| `entrypoint` | Yes | ビルドフォルダ内の HTML ファイルへの相対パス |
| `permissions` | Yes | オブジェクトの**配列**（空配列 `[]` 可）。key-value map は不可 |
| `supported_languages` | Yes | `en`, `de`, `fr`, `es`, `it`, `zh`, `ja`, `ko` |

### 権限タイプ

| 権限名 | 備考 |
|---|---|
| `network` | `whitelist` で許可ドメイン指定。`["*"]` で全許可 |
| `location` | GPS 取得 |
| `g2-microphone` | G2 グラスのマイク |
| `phone-microphone` | スマホのマイク |
| `album` | 写真アルバムアクセス |
| `camera` | カメラアクセス |

> **`desc` フィールド**: 各パーミッションの `desc`（説明文）は **1〜300文字**。公式ドキュメントに記載あり。

### ビルド & パッケージング

```bash
npm run build
evenhub pack app.json dist -o myapp.ehpk
evenhub pack app.json dist -o myapp.ehpk --check  # package_id の利用可能性チェック
```

### CLI コマンド一覧（v0.1.11）

> エイリアス: `evenhub` または `eh` で実行可能。

#### `evenhub login`

| オプション | 説明 |
|---|---|
| `-e / --email <email>` | Even Realities アカウントのメールアドレス |

#### `evenhub init`

| オプション | 説明 |
|---|---|
| `-d / --directory <dir>` | 出力先ディレクトリ |
| `-o / --output <path>` | 出力ファイルパス |

#### `evenhub qr`

| オプション | 説明 |
|---|---|
| `-u / --url <url>` | 開発サーバーの完全 URL |
| `-i / --ip <ip>` | ローカル IP 指定 |
| `-p / --port <port>` | ポート番号 |
| `--path <path>` | URL パス指定 |
| `--https` / `--http` | プロトコル指定 |
| `-e / --external` | 外部ネットワーク向け |
| `-s / --scale <n>` | QR コードのスケール |
| `--clear` | キャッシュ設定をクリア |

#### `evenhub pack <json> <project>`

| オプション | 説明 |
|---|---|
| `-o / --output <file>` | 出力ファイル名 |
| `--no-ignore` | ドットファイルも含める |
| `-c / --check` | `package_id` の利用可能性チェック |

#### シェル補完

```bash
evenhub --completion-bash   # Bash
evenhub --completion-zsh    # Zsh
evenhub --completion-fish   # Fish
```

### よくある pack エラーと対処

| エラー | 対処 |
|---|---|
| `Invalid package id` | 小文字逆ドメイン形式、ハイフン不可、2セグメント以上 |
| `name: must be 20 characters or fewer` | アプリ名を短縮する |
| `version: must be in x.y.z format` | `"1.0.0"` 形式に修正（`v1.0.0` は不可） |
| `permissions: each permission must be an object` | 配列形式であることを確認 |
| `Entrypoint file not found` | `npm run build` を先に実行し、ビルドフォルダ内に entrypoint が存在することを確認 |
| `min_app_version undefined` / `min_sdk_version undefined` | 両方とも必須フィールド。文字列で指定する |
| `supported_languages: invalid language code` | 小文字 ISO コードのみ。対応: `en`, `de`, `fr`, `es`, `it`, `zh`, `ja`, `ko` |
| `Project folder not found` | ビルドフォルダが存在しない。`npm run build` を先に実行する |

---

## 11. Vercel デプロイ（Even Hub 外配布・開発用）

> **Even Hub 配布では Vercel は不要。** .ehpk に全アセットがバンドルされ Even Hub Cloud がホスティングする。
> 以下は PWA 配布、Web UI（ブラウザ全画面の ASCII ビジュアル等）の公開、外部 API バックエンドのホスティングに使用する場合の設定。

### SPA ルーティング設定

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### マルチページ構成

```json
{
  "rewrites": [
    { "source": "/cast",   "destination": "/cast.html" },
    { "source": "/camera", "destination": "/camera.html" }
  ]
}
```

> 全パス rewrite をマルチページ構成に使うと全ページが index.html に吸収されるので注意。

---

## よくあるハマりポイント

| 現象 | 原因 | 対処 |
|---|---|---|
| グラスに何も表示されない | `createStartUpPageContainer` が2回呼ばれている | `useRef` で初期化済みフラグを管理する |
| イベントが来ない | `isEventCapture: 0` になっている | イベントを受けたいコンテナに `isEventCapture: 1` をセット |
| `containerName` が効かない | 16文字を超えている | 16文字以内に収める |
| 画像が表示されない | `createStartUpPageContainer` 内で imageData を渡している | 作成後に `updateImageRawData` を別途呼ぶ |
| 画像コンテナが表示されない | サイズが 200×100 を超えている | **最大 200×100 px** に収める（公式確定値） |
| BMP 画像に横縞が出る | `rowSize` の計算式が誤っている | `Math.ceil(Math.ceil(width/8)/4)*4` に修正 |
| 絵文字がグラスに表示されない | ファームウェアフォントが絵文字非対応 | Unicode 記号（`★☆●○▲▼` 等）で代替 |
| スクロール操作が多重発火する | スクロールイベントが短時間に連発する | ~300ms のデバウンスを実装する |
| リストのアイテムを個別更新できない | リストコンテナは in-place 更新非対応 | `rebuildPageContainer` でページ全体を再構築 |
| QR を読んでも繋がらない | PC と iPhone が別 Wi-Fi にいる | 同じネットワークに接続する |
| Even Hub WebView でカメラが使えない | WKWebView の権限制限 | カメラが必要な機能は別デバイスのブラウザページで担う設計にする |
| pack で `Invalid package id` | ハイフンや大文字が含まれている | 小文字英数のみ、ハイフン不可 |
| シミュレーターと実機で表示が異なる | フォント・スクロール・画像処理に差異あり | 実機テストで最終確認する |
| `textContainerUpgrade` で型エラーになる | 位置引数形式（旧い書き方）を使っている | `new TextContainerUpgrade({...})` オブジェクト形式に変更する |
| 画像が 200×100 を超えるサイズで表示されない | ファームウェアが 200×100 でハードキャップ | SDK README の 288×144 は誤記。200×100 以内にする |
| `imageData` の型が合わない | `number[]` 以外を渡している | SDK v0.0.9 は `number[]`, `Uint8Array`, `ArrayBuffer`, base64 `string` に対応 |
| 手動ディザリングで画像がノイジーになる | ホストの `imageToGray4` と二重処理になっている | 手動ディザリングを除去し、ホストの4-bitダウンサンプリングに任せる |
| シミュレーターでクリックが `sysEvent` で来る | シミュレーターと実機のイベント経路が異なる | `textEvent`, `listEvent`, `sysEvent` の3つ全てをハンドリングする |
