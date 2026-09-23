# Android 版

Android Studio でこの `clients/android` フォルダーを開きます。JDK 17、Android SDK 36、Gradle 9.1.0 と Android Gradle Plugin 9.0.1 を利用します。
最初に Gradle のラッパーを作成する場合は、ローカルに Gradle 9.1.0 を用意し、このフォルダーで
`gradle wrapper --gradle-version 9.1.0` を実行してください。その後 `./gradlew assembleDebug` で APK を作れます。
生成物は `app/build/outputs/apk/debug/app-debug.apk` です。

このアプリはオンラインのキャンバスを Android の専用ウィンドウで開きます。指・対応ペン入力、
写真の選択と書き出しを扱います。最初にオンラインで起動すると画面と作品を端末に保存し、その後はオフラインでも編集できます。同期には接続が必要です。初回実機テストではサインイン、画像選択、
保存先への書き出しを確認してください。iPhone・iPad は後の段階です。
