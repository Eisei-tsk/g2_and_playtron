# Conduct — 開発進捗

開発の進捗とステップごとの詳細手順を管理するファイル。

> **README.md には進捗を書かない**（README はコンテンツ概要・検証・URL 用）。進捗はこのファイルに集約する。

---

## 運用ルール

- **ステップごとにブランチを切って進める。** ブランチの作成・**push**・main へのマージは**開発者が手動で行う**。Claude は現在のブランチで実装 → **コミットまで**を担当する（**push はしない**）。
- **大きな変更・ステップ切り替え時**には、作業と同時にこのファイル（ステータス・変更ログ）を更新する。
- ステータス凡例: `[ ]` 未着手 / `[~]` 進行中 / `[x]` 完了

---

## 現在のステータス

| 項目 | 状態 |
|---|---|
| フェーズ | 音響リッチ化（共有レイヤー＋生成エンジン拡張）|
| 直近の作業 | 共有レイヤー(core)＋Tycho 寄り温かみ・鼓動・セクション・ルーパー残響を実装 |
| ブランチ | `feature/g2-visuals` |
| Node / TS | 22.22.1（`.node-version`）/ TypeScript ~5.9 |
| Even 版 | SDK 0.0.10 / CLI 0.1.13 / Simulator 0.7.3 |

---

## フェーズ0 — 準備（ドキュメント & 雛形）

- [x] 流用ドキュメント（CLAUDE / README / SECURITY）を Conduct 用に書き換え
- [x] PROGRESS.md 作成（進捗管理の運用開始）
- [x] セキュリティ設定（`.npmrc` min-release-age=7 / `.claude/settings.json` deny / `.gitignore` 補強）
- [x] `.node-version`（22.22.1）/ `package.json` 作成
- [x] Vite + React + TypeScript ベース雛形、フォルダ構成（`src/{audio,visual,ws,glasses}` `bridge/`）スキャフォールド
- [x] 依存インストール（React 19 / Vite 8 / Tone.js / ws / easymidi / even_hub_sdk / evenhub-cli）・`npm run build` 検証

## フェーズ1 — Web アプリ

- [x] 1. Node.js ブリッジサーバー（easymidi → WebSocket, 両ポート購読）— 実機確認OK
- [x] 2. キーボード入力（ブラウザ fallback 1–9, hold/release）— Playtron なしでのテスト手段。ステップ3で実装
- [x] 3. Tone.js 基本構成（ペンタトニック量子化・パッド・リバーブ）+ WSクライアント — 発音確認OK
- [x] 4. タッチ時間による音の展開（待機ビープ→触れて約10秒で自律ベッド[コード進行 明↔暗+パッド/ベース/旋律/アルペジオ]が育つ＋触れた音をエッセンスとして展開）※音作りは今後調整の可能性
- [ ] 5. ノート別音色の割り当て（ch=0 のため note 番号ベース）
- [ ] 6. ASCII アニメーション基本実装（インパクト・リップル）
- [ ] 7. 全パターン実装・調整

## フェーズ2 — G2 連携

- [x] 0. **G2 SDK / CLI / Simulator のアップデート調査・更新**（2026-06）。SDK 0.0.10 / CLI 0.1.13 / Simulator 0.7.3 へ。SDK 型定義は差分ゼロ（API 変更なし）。Simulator に `--automation-port`（HTTP 自動化 API: G2 スクショ/入力/console）。CLAUDE.md 反映済み
- [ ] 1. Even Hub WebApp として構成（G2 SDK 接続）
- [ ] 2. IMU 取得・Tone.js パラメータ連動
- [ ] 3. G2 用 ASCII テキスト表示の実装
- [ ] 4. R1 リング操作（ラッチ・リセット・密度調整）
- [ ] 5. フェーズ1 ブラウザ画面と G2 表示の同時動作

---

## 変更ログ

| 日付 | フェーズ/ステップ | 内容 |
|---|---|---|
| 2026-05-23 | フェーズ0 | 流用元（g2_fishing）のドキュメントを Conduct 用に全面書き換え。README/SECURITY を差し替え、CLAUDE.md に §0（プロジェクト固有）を追加。PROGRESS.md を新規作成し進捗管理を開始 |
| 2026-05-23 | フェーズ0 | セキュリティ設定（.npmrc / .claude/settings.json / .gitignore）と Vite+React+TS ベース雛形を作成。Node 22.22.1 固定、TS は evenhub-cli の peer(`^5`) に合わせ ~5.9 を採用。`npm install`（脆弱性0）・`npm run build` 検証 OK |
| 2026-05-23 | フェーズ1 / S1 | MIDIブリッジ（easymidi → WebSocket, localhost:8080）実装。実機(Playtron)で確認 → デバイス名 "Playtron ポート1/2"、**ノード識別は note 番号**（ch=0 固定）、**vel=90 固定**。両ポート購読・USB後挿し再スキャン対応。spec / CLAUDE の MIDI 仕様を実測値へ更新 |
| 2026-05-23 | フェーズ1 / S3 | WSクライアント(src/ws)・Tone.js 音響エンジン(src/audio: ペンタトニック量子化 + パッド/AMSynth + リバーブ)・App 配線・キーボード fallback(1–9 hold/release)を実装。キーボード・**Playtron 実機の両方で発音確認**・bridge:connected 確認。build / dev 検証 OK |
| 2026-05-24 | フェーズ1 / S4 | 生成音楽エンジンへ刷新。3層モデル: 待機(うっすら短いビープ)→触れて development(0→1, ~10s)で自律ベッド(コード進行 明↔暗+パッド/ベース/旋律/アルペジオ)が育つ＋触れた音をペンタ吸着でエッセンスとして上に乗せる。離すと待機へ減衰。第一版採用（音作りは今後調整の可能性あり）|
| 2026-06-14 | フェーズ2 / S0 | Even SDK/CLI/Simulator を調査・最新化（SDK 0.0.9→0.0.10 / CLI 0.1.11→0.1.13 / Sim 0.7.2→0.7.3）。SDK 型定義は差分ゼロ＝API 変更なし。Simulator `--automation-port`（`/api/screenshot/glasses` 576×288 PNG, `/api/input`, `/api/console`）を把握＝撮影ワークフローに活用可。build 検証 OK・脆弱性0。CLAUDE.md のバージョン/履歴/Simulator 節を更新 |
| 2026-06-15 | 音響 | **共有レイヤー(src/core)** を新設: worldClock(潮・非可換周期)/gestures(会話の語彙)/echoes(残響)。音・ビジュアルが購読する headless 設計。生成エンジンに統合 |
| 2026-06-15 | 音響 | 会話の語彙: 挨拶/問いかけ/耳をすます/重なる声/間。**ルーパー残響**(2秒ごと反復→減衰→積層)で 1/2タップも反芻。問いかけは**2タップ**に |
| 2026-06-15 | 音響 | 蓄積モデル(arc): 触れると蓄積・離すと数分でゆっくり戻る。**多段セクション(30s/60s/180s = intro/develop/climax/full)**、到来時に whoosh で「一気に開ける」flourish＋音量上昇。**再帰モチーフ**(触れた音=テーマ)、**breadth**(触れた物の数で複雑さ・音色差) |
| 2026-06-15 | 音響 | **Tycho 寄りの温かみ**: fat オシレーター/テープ的サチュレーション/高域カット/コーラス/アナログ的フィルター揺れ。**森エッセンス**(風のさざめき・遠い鳥・水の滴り)、**鼓動**(まばらな lub-dub)。全 PolySynth に maxPolyphony 設定でノイズ/停止対策。build 検証 OK |
