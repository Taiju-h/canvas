# Android 版

Android Studio でこの `clients/android` フォルダーを開きます。JDK 17、Android SDK 36、Gradle 9.1.0 と Android Gradle Plugin 9.0.1 を利用します。
最初に Gradle のラッパーを作成する場合は、ローカルに Gradle 9.1.0 を用意し、このフォルダーで
`gradle wrapper --gradle-version 9.1.0` を実行してください。その後 `./gradlew assembleDebug` で APK を作れます。
生成物は `app/build/outputs/apk/debug/app-debug.apk` です。

## 0.2 native preview

WebView を描画本体に使わず、Android のネイティブ `View` / hardware accelerated `Canvas` でペン入力を直接描画します。
描画中にネットワーク・JavaScript・DOM を通さないため、Android 版ではまず「Concepts のように軽く、ペンについてくる感触」を最優先にします。

現在の native preview は以下を実装しています。

- MotionEvent の履歴点をすべて取り込み、高速なペン移動でも線を途切れにくくする
- 端末の 60/90/120Hz フレームクロックに合わせた再描画
- スタイラス筆圧による線幅変化
- 1本指/ペンで描画、2本指で無限キャンバスのパン・ピンチズーム
- 画面外ストロークの描画を省く簡易カリング
- ペン、ストローク消しゴム、Undo/Redo、方眼表示、表示位置リセット
- アプリ内バイナリ形式で自動保存し、次回起動時に復元

この段階では Web 版との同期・複数ドキュメント・画像配置・定規/図形補正などはまだ native 側へ移していません。まず実機でペン追従、ズーム、長時間描画の軽快さを詰め、その上に既存 Canvas の機能を順次載せます。
