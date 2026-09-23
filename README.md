# UZERO キャンバス

`https://uzero.style/canvas/` 用のベクターキャンバスです。`canvas/` がソース、`public/canvas/` が公開ファイルです。既存の武将サイトや `nobunaga` DBには依存しません。

## 保存とログイン

- 作品と画像は端末の IndexedDB に自動保存されます。最初にオンラインで画面を開いた後は、キャッシュした作品をオフラインで編集できます。
- ログイン後は専用 MySQL DB `canvas` に作品と画像を保存し、再接続時に同期します。所有者は共有リンクを発行でき、リンクを持つ人はログインなしで同じ作品を編集できます。共同編集は約2.4秒ごとの更新確認と競合時の統合です。
- 「ファイルと書き出し」から編集可能な JSON を保存・読み込みできます。ブラウザやアプリの保存データを削除すると端末上の作品も消えるため、大切な作品は JSON に書き出してください。
- 元の ChatGPT Site と uzero.style は別の保存先です。前の作品を移すには元サイトで JSON を保存し、この `/canvas/` で「作品を読み込む」を選んでください。ログインアカウントや既存データは自動移行されません。

## DBの準備

運用先の PHP は PDO MySQL・mbstring・fileinfo が利用できる状態にします。MySQL 8 以降を想定しています。管理者で既存の `canvas` DB がないことを確認してから、初回のみ以下を実行します。`nobunaga` DBには適用しません。

### デプロイとDB作成をまとめて実行する場合

先に [PR #8](https://github.com/Taiju-h/uzero-style/pull/8) を GitHub の `main` にマージします。サーバーへ SSH 接続し、Git 作業ツリーの状態を表示してから次を実行してください。メールアドレスはキャンバスの初期ログイン用に置き換えます。PHP の実行ユーザーが `www-data` 以外なら最後の引数も変更してください。

```bash
cd /var/www/uzero.style
git status --short --branch
git fetch origin main
canvas_script=$(mktemp /tmp/uzero-canvas-deploy.XXXXXX)
git show origin/main:canvas/bin/deploy-canvas.sh > "$canvas_script" && sudo bash "$canvas_script" user@example.com www-data
rm -f "$canvas_script"
```

スクリプトは未コミット変更、分岐したGit履歴、キャンバス以外の未反映差分、既存の同名DBがある場合に停止します。`git reset --hard` やDBの削除は行いません。初回だけMySQL管理者のパスワードとキャンバスのログイン用パスワードを対話入力します。専用DB `canvas`、4テーブル、制限付きDBユーザー、公開領域外の `CONF/canvas-db.ini` を作り、Gitを早送りしてPHP・DB・公開URLを確認します。既存の `CONF/canvas-db.ini` は上書きしません。停止した場合は表示された理由を確認してから再実行してください。

以下は自動スクリプトを使わず個別に設定する場合の手順です。自動スクリプトを完了した後に再実行する必要はありません。

画像を最大10MBまで使う場合、サーバーの PHP 設定で `upload_max_filesize` と `post_max_size` をそれぞれ 12MB 以上にし、MySQL の `max_allowed_packet` を 16MB 以上にしてください。

```bash
mysql -u root -p < canvas/sql/create-database.mysql.sql
mysql -u root -p canvas < canvas/sql/schema.mysql.sql
```

専用のアプリDBユーザーに `canvas.*` の `SELECT, INSERT, UPDATE, DELETE` のみを付与します。管理者パスワードやDBパスワードは Git に保存しません。

`CONF/canvas-db.ini.example` をサーバーの `/var/www/uzero.style/CONF/canvas-db.ini` にコピーして、DB接続情報と `auth.pepper`（64桁のランダムな16進数）を設定します。公開ディレクトリの外に置き、PHP実行ユーザーだけが読める権限にしてください。この実ファイルはリポジトリの `.gitignore` の対象です。

```bash
cd /var/www/uzero.style
cp -n CONF/canvas-db.ini.example CONF/canvas-db.ini
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
# 表示した値を CONF/canvas-db.ini の pepper に記入する
```

初回のユーザーはサーバーのコマンドラインから作ります。パスワードは入力時に隠され、ハッシュだけDBに保存されます。公開画面からの自由登録はありません。

```bash
php canvas/bin/create-user.php user@example.com
```

DBが未設定の間も `/canvas/` は端末内だけで使用できます。ログインページは設定不足を表示し、保存APIは作品を失わないようエラーを返します。

## 公開とビルド

`uzero.style` の HTTPS DocumentRoot が `/var/www/uzero.style/public` であること、`public/canvas/*.php` をPHPとして実行できることを先に確認します。別の DocumentRoot の場合は、その公開ディレクトリへ `public/canvas/` を配置し、PHP入口からリポジトリ内の `canvas/server/bootstrap.php` を参照できるようにします。`.htaccess` の書き換えには依存していません。

Gitに含まれる `public/canvas/` の画面とアセットはビルド済みです。後で画面を変更した場合だけ、以下を実行し、生成ファイルもコミットします。

```bash
cd /var/www/uzero.style/canvas
npm install
npm run build
```

`public/canvas/offline-assets.json` と `sw.js` はビルド時に更新され、アセットのバージョンに応じてオフラインキャッシュも切り替わります。PHPの保存APIとログインはオフラインキャッシュに入れません。初回のネット接続とHTTPSが必要です。

`clients/android/` と `clients/windows/` は `https://uzero.style/canvas/` を開くアプリのソースです。APKとWindowsインストーラーはこのリポジトリに含めていません。サーバーのDB、実機でのオフライン起動と画像の入出力は、サーバー反映後に確認してください。
