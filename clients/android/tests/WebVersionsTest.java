package work.heartful.canvas;
public final class WebVersionsTest {
    public static void main(String[] args) {
        if (!WebVersions.sameCommit("f95ded9", "f95ded96580657a9c9843fba5df5ce91b7342c4f")) throw new AssertionError("short commit");
        if (WebVersions.sameCommit("f95ded9", "f2b880f")) throw new AssertionError("different commit");
        if (WebVersions.sameCommit("", "") || WebVersions.sameCommit(null, "f95ded9")) throw new AssertionError("invalid commit");
        if (WebVersions.canInstall(0, 300, 200) || WebVersions.canInstall(100, 300, 200)) throw new AssertionError("downgrade");
        if (!WebVersions.canInstall(300, 100, 300) || !WebVersions.canInstall(400, 300, 200)) throw new AssertionError("current/newer bundle");
        System.out.println("Web version tests passed");
    }
}
