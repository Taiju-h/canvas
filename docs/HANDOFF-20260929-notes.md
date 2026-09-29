# Canvas Notes 引き継ぎ（2026-09-29）

## Gitと承認

- 対象: Taiju-h/canvas
- 開始時のmain: 59ea035e22e0349b26b9dafa171fad10dba50d1f
- 開始時: 未コミット変更なし、未統合PRなし。
- 作業ブランチ: codex/20260929-notes-workspace
- ユーザー承認: 「OK,jaa実装してみて。リストはたためるのかい？」
- 範囲: メモUI、折りたたみ一覧、文字主体・ペン自動判別、分類整理、JEX添付込み取り込み、保存修正。Git保存まで。本番デプロイは未実施。
- 他担当の手元、本番Git状態、ハートフルタスクは未確認。タスクへの書き込みも未実施。Git更新済み／本番反映済みを混同しないこと。

## 実装

`src/components/notes-workspace.tsx` を標準起動画面に変更。
`src/lib/use-notes.ts` に文書単位の保存キュー、未同期保護、競合回収。
`src/lib/jex.ts` と `import-jex.ts` にTAR検査・JEX取り込み・元IDでの重複防止。
`server/notes.php` にページング一覧・認証付き添付と分割転送。
`docs/NOTES-WORKFLOW.md` にユーザー合意した分類整理運用を記録。

## 検証

- TypeScript・Vite本番ビルド成功。
- PHPパーサーで変更PHPを構文確認（この実行環境にはPHP実行バイナリなし）。デプロイスクリプトは本番のPHPで `php -l` を行う。
- Bash構文確認。既存デプロイのラスターレイヤー／ブラシ適用スクリプトを実行した状態でも本番ビルド成功。
- 日本語フォントを使ったデスクトップ・スマホ画面の目視確認。スマホで本文ブロックが画面幅に収まることを確認。
- ローカルChromium＋モックAPI: 初期フォーカス、日本語複数行、保存ループ停止、一覧開閉記憶、検索、ペン描画、ブロック移動、保存中の再編集、未同期復元、競合コピーを確認。
- ユーザー提供のJEXで237メモ・40ノートブック・3タグ・44添付を解析。
- 同JEXをブラウザからモックAPIに取り込み、237件の完了、44添付IDの転送、100件ごとの一覧取得、再取込時の237件スキップを確認。
- 実データや画面はGitに含めない。

## 本番前に残る確認

- PHP/MySQL実APIでの保存、所有者認証、添付転送・取得。
- 実機Windows/Androidのペン、IME、タッチ操作。
- 本番へのJEX取り込み。まだ実行していない。
- Dropbox自動同期は未実装。JEX一回移行の取り込み。

## 配置

DBスキーマ変更なし。PHP実行ユーザーが `var/attachments` に書けることが必要。
既存デプロイスクリプトには `install -d -m 0700 -o "${CANVAS_PHP_USER:-www-data}" .../var/attachments` と新PHPファイルの構文確認を追加。
PHPアップロード上限は分割転送1MiB＋フォーム分の余裕を確保（5MB以上推奨）。動画はブラウザが対応しない形式でも原本を保持し、ダウンロード可能。

## 再検証コマンド

- `npm install && npm run build && npm test`
- ブラウザ試験: Playwrightを利用できる環境でViteを起動し、`npm run test:browser`。必要に応じて `CHROMIUM_EXECUTABLE`、`CANVAS_TEST_URL` を指定。
- `JEX_TEST_FILE=/path/to/archive.jex npm test` は任意のローカル添付検証用。JEXファイルそのものはGitに追加しない。
