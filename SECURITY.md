# セキュリティガイドライン

Conduct（Playtron × Even G2）プロジェクトで適用するセキュリティ対策をまとめる。

> **最終更新: 2026-05-23**

---

## 1. npm サプライチェーン対策

### 背景

2026-03-31 に axios（週間1億DL）がサプライチェーン攻撃を受けた。メンテナーの npm アカウントが乗っ取られ、`postinstall` フックで RAT（遠隔操作トロイの木馬）を仕込んだバージョンが約3時間公開された。

- 参考: https://blog.flatt.tech/entry/axios_compromise

本プロジェクトは Tone.js・`easymidi`・`ws` などのサードパーティ依存に加え、Vite のネイティブツールチェーンを使うため、依存の取り込みに注意が必要。

### 適用している対策

#### `.npmrc`

```ini
min-release-age=7        # 公開から7日未満のバージョンをインストールしない
```

| 設定 | 効果 | トレードオフ |
|---|---|---|
| `min-release-age=7` | 公開直後の悪意あるバージョンを自動的にブロック（7日の隔離期間） | 緊急のセキュリティパッチが即時適用できない |

#### `ignore-scripts=true` を採用しなかった理由

当初は `ignore-scripts=true` も併用して postinstall フックを完全に無効化する案を検討したが、**以下の理由で採用を見送った**:

1. **開発・実行への影響が大きすぎる**: Vite の `rolldown` / `esbuild` などネイティブバイナリを使うパッケージや、MIDI ブリッジで使う **`easymidi`（`node-midi` の native アドオンを node-gyp でビルドする）** が動作しなくなる
2. **`min-release-age=7` だけで十分な防御力**: 参考にした axios 攻撃（2026-03-31）は3時間で検知・削除されており、7日の隔離期間で完全にブロックできた
3. **過剰防御**: 追加の保護効果に対して、開発体験への悪影響が釣り合わない

代わりに以下の運用で補強する:
- `package-lock.json` を git にコミットし CI で `npm ci` を使用（依存関係の固定）
- `npm audit` を定期実行
- 不審な挙動を示すパッケージは即座に確認

> **判断根拠**: 本プロジェクトのセットアップ時（2026-05）に、Vite のネイティブバイナリ（rolldown / esbuild）と `easymidi`（`node-midi` の native ビルド）が `ignore-scripts=true` だと動作しないため、トレードオフを再評価した結果。

#### その他の対策

| 対策 | 方法 |
|---|---|
| **lockfile の固定** | `package-lock.json` を git にコミット。CI では `npm ci` を使用 |
| **依存の最小化** | SDK（`@evenrealities/even_hub_sdk`）はランタイム依存ゼロ。追加パッケージは慎重に選定 |
| **定期的な監査** | `npm audit` を定期実行 |
| **バージョン固定** | `package.json` で `^` の範囲を適切に管理 |

#### 不審なパッケージを調査する場合

一時的に特定のパッケージのスクリプトを無効化したい場合:

```bash
# スクリプトを実行せずにインストール
npm install --ignore-scripts <package-name>

# あとから手動でスクリプトを実行（easymidi など native ビルドが必要なものは rebuild が要る）
npm rebuild <package-name>
```

---

## 2. MIDI ブリッジ / WebSocket のローカル運用

Playtron からの MIDI を受け取って WebSocket で配信する Node.js ブリッジサーバーは、**ローカル（localhost）限定で運用する**。

| 項目 | 方針 |
|---|---|
| バインドアドレス | `localhost` / `127.0.0.1` に限定し、LAN・外部に公開しない |
| 認証 | ローカル限定のため不要。外部公開する設計に変える場合は認証・オリジン検証を追加する |
| 受信データ | ブリッジは `{type, note, velocity, channel}` のみを送る。任意コード実行につながる入力は扱わない |
| 実機テスト時 | `evenhub qr` で開発サーバーを LAN 公開する際は、同一 Wi-Fi の信頼できるネットワークでのみ行う |

> ブリッジは MIDI 入力を中継するだけの薄い層に保つ。クライアントからブリッジへ任意コマンドを送れる経路は作らない。

---

## 3. AI アシスタント（Claude Code）に対するセキュリティ

### 背景

AI コーディングアシスタントはファイルを読み取って回答を生成する。`.env` や秘密鍵などの機密ファイルが AI に読み込まれると、コンテキストウィンドウに機密情報が含まれるリスクがある。

### 適用している対策

#### `.claude/settings.json`（プロジェクト共有設定）

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./.env.local)",
      "Read(./.env.production)",
      "Read(./.env.development)",
      "Read(./secrets/**)",
      "Read(./*.key)",
      "Read(./*.pem)",
      "Read(./*.crt)",
      "Read(./credentials.json)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)",
      "Read(~/.npmrc)"
    ]
  }
}
```

#### 設定ファイルの種類と優先順位

| 優先度 | ファイル | スコープ | 用途 |
|---|---|---|---|
| 1（最高） | `managed-settings.json` | 組織全体 | 管理者が強制適用。他で上書き不可 |
| 2 | コマンドライン引数 | セッション | 一時的な上書き |
| 3 | `.claude/settings.local.json` | プロジェクト（個人） | git にコミットしない個人設定 |
| 4 | `.claude/settings.json` | プロジェクト（チーム共有） | git にコミットしてチームで共有 |
| 5（最低） | `~/.claude/settings.json` | 全プロジェクト | 個人のグローバル設定 |

> **重要**: いずれかのレベルで `deny` されたツールは、他のレベルで `allow` しても上書きできない。

#### パスパターンの書式

| パターン | 意味 | 例 |
|---|---|---|
| `./path` | プロジェクトルートからの相対パス | `Read(./.env)` |
| `/path` | プロジェクトルートからの相対パス | `Read(/secrets/**)` |
| `~/path` | ホームディレクトリからのパス | `Read(~/.ssh/**)` |
| `//path` | ファイルシステムの絶対パス | `Read(//etc/passwd)` |
| `*` | 単一ディレクトリ内のワイルドカード | `Read(./*.key)` |
| `**` | 再帰的ワイルドカード | `Read(./secrets/**)` |

---

## 4. `.gitignore` による機密ファイル保護

以下のファイルは `.gitignore` に含めて git リポジトリにコミットしない。

```gitignore
# 環境変数・シークレット
.env
.env.*
.env.local
.env.production
.env.development
secrets/

# 秘密鍵・証明書
*.key
*.pem
*.crt
credentials.json

# Node.js
node_modules/

# Claude Code ローカル設定
.claude/settings.local.json
```

---

## 5. チェックリスト

新しいメンバーがプロジェクトに参加した時、またはセットアップ時に確認する項目:

- [ ] `.npmrc` が存在し、`min-release-age=7` が設定されている（`ignore-scripts=true` は採用しない。理由は §1）
- [ ] `.claude/settings.json` が存在し、機密ファイルの `deny` ルールが設定されている
- [ ] `.gitignore` に `.env*`, `secrets/`, `*.key`, `*.pem`, `node_modules/` が含まれている
- [ ] `package-lock.json` が git にコミットされている
- [ ] MIDI ブリッジ / WebSocket サーバーが localhost 限定でバインドされている
- [ ] 機密情報（API キー、トークン等）がソースコードにハードコードされていない
- [ ] `npm audit` でクリティカルな脆弱性がない

---

## 6. インシデント対応

npm パッケージの侵害が疑われる場合:

1. **バックドアファイルの確認**
   ```bash
   # macOS
   ls -la /Library/Caches/com.apple.act.mond
   # Linux
   ls -la /tmp/ld.py
   ```

2. **悪意あるパッケージの検索**
   ```bash
   find node_modules -name "package.json" -exec grep -l "postinstall" {} \;
   ```

3. **lockfile の確認**
   ```bash
   grep -r "plain-crypto-js" package-lock.json  # axios 攻撃の例
   ```

4. **クレデンシャルのローテーション**
   - npm トークン
   - クラウドキー（AWS / GCP / Vercel）
   - SSH キー
   - `.env` 内の全シークレット

5. **ネットワークログの確認**
   - 不審な外部通信がないか確認
