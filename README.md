# UZERO キャンバス

`https://canvas.uzero.style/canvas/` 用のベクターキャンバスです。`canvas/` がソース、`public/canvas/` が公開ファイルです。既存の武将サイトや `nobunaga` DBには依存しません。

## 保存とログイン

- 作品と画像は端末の IndexedDB に自動保存されます。最初にオンラインで画面を開いた後は、キャッシュした作品をオフラインで編集できます。
- ログイン後は専用 MySQL DB `canvas` に作品と画像を保存し、再接続時に同期します。所有者は共有リンクを発行でき、リンクを持つ人はログインなしで同じ作品を編集できます。共同編集は約2.4秒ごとの更新確認と競合時の統合です。
- 「ファイルと書き出し」から編集可能な JSON を保存・読み込みできます。ブラウザやアプリの保存データを削除すると端末上の作品も消えるため、大切な作品は JSON に書き出してください。
- 元の ChatGPT Site と uzero.style は別の保存先です。前の作品を移すには元サイトで JSON を保存し、この `/canvas/` で「作品を読み込む」を選んでください。ログインアカウントや既存データは自動移行されません。

## DBの準備

運用先の PHP は PDO MySQL・mbstring・fileinfo が利用できる状態にします。MySQL 8 以降を想定しています。管理者で既存の `canvas` DB がないことを確認してから、初回のみ以下を実行します。`nobunaga` DBには適用しません。

### Canvas専用ブランチからデプロイし、DBを作成する場合

本番の `/var/www/uzero.style` は未コミット変更があるので `git pull` しません。別ディレクトリ `/var/www/canvas.uzero.style` に Canvas 専用ブランチを追加し、`canvas/`、`public/canvas/`、秘密設定の除外に使う `.gitignore` だけを展開します。既存の `nobunaga` や本番 `main` の作業ファイルは変更しません。

以下をサーバーの SSH ターミナルで実行します。`your-address@domain.jp` は実際の初期ログイン用メールに置き換えてください。PHP実行ユーザーが違う場合は `www-data` も変更してください。

```bash
cd /var/www/uzero.style || exit 1
git fetch origin 'refs/heads/canvas/isolated-deploy-20260923:refs/remotes/origin/canvas/isolated-deploy-20260923'
canvas_script=$(mktemp /tmp/uzero-canvas-deploy.XXXXXX)
git show origin/canvas/isolated-deploy-20260923:canvas/bin/deploy-canvas.sh > "$canvas_script" &&
  sudo bash "$canvas_script" your-address@domain.jp www-data
```

スクリプトは最新の取得済み `main` を確認し、Canvas以外の差分が専用ブランチに入っていないことを検査します。Canvasの作業ツリー・専用DB `canvas`・4テーブル・ログインユーザーを用意した後、Apacheのこのサブドメインにある `DocumentRoot /var/www/uzero.style/canvas` を `DocumentRoot /var/www/canvas.uzero.style/public` に変更します。該当する `<Directory>` のパスも更新し、トップページ `/` は `/canvas/` へ転送します。Apache構文確認・再読込・公開URLとPHP APIの動作確認を行います。Apache設定が確認時と違えば変更前に止まり、構文確認や再読込に失敗すれば元へ戻します。`nobunaga` DBは触りません。

以下は自動スクリプトを使わず個別に設定する場合の手順です。自動スクリプトを完了した後に再実行する必要はありません。

画像を最大10MBまで使う場合、サーバーの PHP 設定で `upload_max_filesize` と `post_max_size` をそれぞれ 12MB 以上にし、MySQL の `max_allowed_packet` を 16MB 以上にしてください。

```bash
mysql -u root -p < /var/www/canvas.uzero.style/canvas/sql/create-database.mysql.sql
mysql -u root -p canvas < /var/www/canvas.uzero.style/canvas/sql/schema.mysql.sql
```

専用のアプリDBユーザーに `canvas.*` の `SELECT, INSERT, UPDATE, DELETE` のみを付与します。管理者パスワードやDBパスワードは Git に保存しません。

手動設定する場合は `CONF/canvas-db.ini.example` の内容を `/var/www/canvas.uzero.style/CONF/canvas-db.ini` に置き、DB接続情報と `auth.pepper`（64桁のランダムな16進数）を設定します。公開ディレクトリの外に置き、PHP実行ユーザーだけが読める権限にしてください。この実ファイルはリポジトリの `.gitignore` の対象です。

```bash
umask 077
git -C /var/www/canvas.uzero.style show HEAD:CONF/canvas-db.ini.example \
  > /var/www/canvas.uzero.style/CONF/canvas-db.ini
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
# 表示した値を CONF/canvas-db.ini の pepper に記入する
chown root:www-data /var/www/canvas.uzero.style/CONF/canvas-db.ini
chmod 640 /var/www/canvas.uzero.style/CONF/canvas-db.ini
```

初回のユーザーはサーバーのコマンドラインから作ります。パスワードは入力時に隠され、ハッシュだけDBに保存されます。公開画面からの自由登録はありません。

```bash
php /var/www/canvas.uzero.style/canvas/bin/create-user.php user@example.com
```

DBが未設定の間も `/canvas/` は端末内だけで使用できます。ログインページは設定不足を表示し、保存APIは作品を失わないようエラーを返します。

## 公開とビルド

`canvas.uzero.style` の DocumentRoot は `/var/www/canvas.uzero.style/public`、アプリのURLは `https://canvas.uzero.style/canvas/` です。`/` から `/canvas/` への転送はこのサブドメインのApache設定に置きます。`public/canvas/*.php` をPHPとして実行できること、HTTPS証明書がこのサブドメインで有効なことを確認します。`.htaccess` の書き換えには依存していません。

Gitに含まれる `public/canvas/` の画面とアセットはビルド済みです。後で画面を変更した場合だけ、以下を実行し、生成ファイルもコミットします。

```bash
cd /var/www/canvas.uzero.style/canvas
npm install
npm run build
```

`public/canvas/offline-assets.json` と `sw.js` はビルド時に更新され、アセットのバージョンに応じてオフラインキャッシュも切り替わります。PHPの保存APIとログインはオフラインキャッシュに入れません。初回のネット接続とHTTPSが必要です。

`clients/android/` と `clients/windows/` は `https://canvas.uzero.style/canvas/` を開くアプリのソースです。APKとWindowsインストーラーはこのリポジトリに含めていません。サーバーのDB、実機でのオフライン起動と画像の入出力は、サーバー反映後に確認してください。
