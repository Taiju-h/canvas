package work.heartful.canvas;
public final class WebAssetPathsTest {
    public static void main(String[] args) {
        expect("/", "index.html"); expect("/canvas", "index.html"); expect("/canvas/", "index.html");
        expect("/index.html", "index.html"); expect("/canvas/index.html", "index.html");
        expect("/assets/app.js", "assets/app.js"); expect("/canvas/assets/app.js", "assets/app.js");
        expect("/canvas/sw.js", "sw.js"); expect("/sw.js", "sw.js");
        for (String path : new String[]{null,"/api.php","/canvas/api.php","/canvas/login.php","/canvas-other/","/canvas/../secret","/assets/../../secret","/canvas/assets\\secret","/canvas//index.html","/CONF/canvas-db.ini","/canvas/assets/app.js\0"}) expect(path,null);
        System.out.println("PASS root/canvas assets, dynamic endpoints, traversal and secret-path rejection");
    }
    private static void expect(String path,String expected) {
        String actual=WebAssetPaths.relative(path);
        if (expected==null?actual!=null:!expected.equals(actual)) throw new AssertionError(path+" -> "+actual);
    }
}
