# Android 版

Android 版は **Web-first の薄いシェル** です。機能本体は `https://canvas.uzero.style/` の Web 版で管理します。

## 方針

- 描画、レイヤー、画像配置、Excel/表計算、グラフ、保存・同期は Web 側が正本です。
- Android アプリは WebView で最新版の Canvas を表示します。
- 通常の機能追加や UI 修正では APK の再ビルド・再インストールは不要です。
- APK を作り直すのは Android 固有の変更（WebView 設定、権限、ファイル選択、OS 連携など）がある場合だけです。
- 旧ネイティブ描画版は Git 履歴に残し、現行 APK では使用しません。

## Android シェルで担当するもの

- `https://canvas.uzero.style/` の表示
- JavaScript / DOM Storage / Cookie
- Android のファイル選択を Web の `<input type="file">` へ接続
- Canvas ドメイン外リンクを外部アプリで開く
- HTTP(S) ダウンロードを Android Download Manager へ渡す
- 戻る操作を WebView 履歴へ接続
- 通信エラー時の再読み込み UI

## ビルド

Android Studio で `clients/android` を開きます。JDK 17、Android SDK 36、Gradle 9.1.0、Android Gradle Plugin 9.0.1 を利用します。

```bash
gradle wrapper --gradle-version 9.1.0
./gradlew assembleDebug
```

生成物: `app/build/outputs/apk/debug/app-debug.apk`

Web 側だけを更新した場合、この APK を再作成する必要はありません。

## 0.4.1 Androidシェル対応（2026-10-13）

- Word・PNG・TXT・MD・分類JSON・端末内添付のblob/data URLをAndroidの「保存先を選択」へ接続。256KiBずつ転送し、一括書き出しは保存ダイアログを順番に表示する。保存失敗・取消を成功扱いにしない。保存の上限は1ファイル512MiB。
- ファイル選択を取り消した場合と、対応アプリがない場合にWebへ結果を返す。
- WebViewとService Workerの両方で、同梱／更新済みWeb画面をオフライン取得。ルートと `/canvas/` に対応する。未取得のノート・添付、初回認証、ChatGPT API通信には接続が必要。
- APKアップグレード時に古いダウンロード済みWeb画面を除去し、新APKの同梱Web版を利用する。IndexedDBのノート・添付やCookieは消さない。その後は画面の「更新あり」からWeb版だけを更新できる。
- 戻る操作をAndroid 16のジェスチャーにも対応させる。画面回転ではWebViewを保持。Activity再作成時は履歴を復元する。Android 11以降のシステムバー・キーボード領域を除けて編集画面を表示する。
- 保存メッセージはCanvasのHTTPSオリジン・メインフレーム限定。追加のストレージ権限は不要。Android System WebViewが保存用のメッセージ機能を備えている必要がある。

`node --test clients/android/tests/native-downloads.test.mjs` で保存キュー・分割・日本語・エラー回復を検証する。Javaのパス検証は `clients/android/tests/WebAssetPathsTest.java`。GitHub ActionsはAndroid側の変更時にdebug APKをビルドし、署名済みrelease APKは既存のreleaseワークフローで作る。

実機では次を確認する（自動テストだけでは確認済みとしない）。

1. 既存APKへ同じ署名の新版を上書きし、既存ノート・添付が保持される。
2. 日本語入力中の回転、画像／音声／JEX選択、選択取消。
3. Word・PNG・TXT・MDと添付の保存、保存取消、一括分類の連続保存。
4. 全ノート・添付を端末へ保存し、機内モードでアプリを閉じて再起動、編集、添付、書き出し。
5. 接続復帰後の同期・Web更新、ChatGPTの実通信。

## 0.4.2 Web更新と編集UI

今回の仕様では同梱Web画面とシェルを更新し、versionCode 9／0.4.2-web-shellとする。既存配布APKの版・署名と実機のデータ保持は別途照合する。Release Actionsは既存の署名secretを使い、署名を検証して `KaeruNote-0.4.2.apk` とAABを生成する。署名secretがない場合は失敗とし別鍵へ置換しない。

「更新あり」から静的UIを別領域へ取得し、端末への保存を確認してから切り替える。ノートURLとハッシュを保持する。起動したWebバンドルのコミットを確認するまで旧UIを残し、失敗時や途中のプロセス終了は静的UIを戻す。IndexedDBとCookieは維持する。日本語変換中には適用しない。通常のWeb UI変更はこの更新方式で配布し、シェル変更がなければAPKの再ビルドは不要。

操作・分類競合・検証条件は `docs/KAERUNOTE-RECOVERY-20261013.md` を参照する。
