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
