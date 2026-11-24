package work.heartful.canvas;
public final class WebVersionsTest {
    public static void main(String[] args) {
        if (WebVersions.browserMajor("74.0.3729.185") != 74 || WebVersions.browserMajor("111.0.5563.57") != WebVersions.MIN_WEBVIEW_MAJOR || WebVersions.browserMajor("150.0.1-dev") != 150 || WebVersions.browserMajor(null) != 0 || WebVersions.browserMajor("unknown") != 0) throw new AssertionError("WebView provider version");
        if (!WebVersions.sameCommit("f95ded9", "f95ded96580657a9c9843fba5df5ce91b7342c4f")) throw new AssertionError("short commit");
        if (WebVersions.sameCommit("f95ded9", "f2b880f")) throw new AssertionError("different commit");
        if (WebVersions.sameCommit("", "") || WebVersions.sameCommit(null, "f95ded9")) throw new AssertionError("invalid commit");
        if (WebVersions.canInstall(0, 300, 200) || WebVersions.canInstall(100, 300, 200)) throw new AssertionError("downgrade");
        if (!WebVersions.canInstall(300, 100, 300) || !WebVersions.canInstall(400, 300, 200)) throw new AssertionError("current/newer bundle");
        System.out.println("Web version tests passed");
    }
}
