# Canvas

`https://canvas.uzero.style/` の専用リポジトリです。

Canvas は `uzero-style` から分離済みで、このリポジトリの `main` が正本です。アプリのソースもサーバー処理もリポジトリ直下に置き、`canvas/` という追加階層は作りません。

## 構成

```text
Canvas/
├─ src/                    React / TypeScript エディタ
├─ server/                 PHP 共通処理
├─ sql/                    MySQL スキーマ・マイグレーション
├─ scripts/                ビルド時の描画機能パッチ等
├─ bin/                    デプロイ・管理コマンド
├─ clients/                Android / Windows クライアント
├─ public/                 Vite用静的元ファイル
│  └─ canvas/              本番Webルート（PHP + 生成物）
├─ CONF/                   DB設定例。実設定はGit管理外
├─ index.html
├─ package.json
├─ vite.config.ts
└─ tsconfig.json
```

サーバー上の配置は `/var/www/canvas.uzero.style` です。Apache は従来どおり `/var/www/canvas.uzero.style/public/canvas` を公開ディレクトリとして利用できます。`/canvas/` の互換URLも維持します。

## 本番デプロイ

Node.js 20以上が必要です。通常の更新も、旧 `uzero-style` worktree からの初回移行も同じスクリプトで行えます。

```bash
curl -fsSL https://raw.githubusercontent.com/Taiju-h/canvas/main/bin/upgrade-hybrid-v2.sh | sudo bash
```

初回だけ、既存 `/var/www/canvas.uzero.style/CONF/canvas-db.ini` を新しい standalone リポジトリへ引き継いでから、旧 worktree を解除します。DBの内容は移動せず、そのまま既存の `canvas` DBを使います。

2回目以降は `/var/www/canvas.uzero.style` の `main` を fast-forward し、DBスキーマ確認、TypeScript確認、Vite本番ビルド、PHP構文確認まで自動で行います。

## DB設定

実設定は `CONF/canvas-db.ini` に置き、Gitには保存しません。ひな形は `CONF/canvas-db.ini.example` です。

```bash
cp CONF/canvas-db.ini.example CONF/canvas-db.ini
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

`pepper` とDB接続情報を設定してください。本番ではPHP実行ユーザーだけが読める権限にします。

## ビルド

ローカルで確認する場合はリポジトリのトップで実行します。

```bash
npm install --package-lock=false
npm run build
```

生成先は `public/canvas/` です。`assets/`、Vite manifest、`index.html`、Service Worker 等の生成物はGit管理外です。`api.php`、`login.php`、`admin-visitors.php` はGit管理対象です。

## 保存

作品・画像はブラウザのIndexedDBと専用MySQL DB `canvas` を利用します。ニックネーム利用者も専用IDを持ち、保存作品を後から開けます。ラスターレイヤー画像は `canvas_images` に保存します。

`uzero.style` と `nobunaga` はこのリポジトリのデプロイ対象ではありません。
