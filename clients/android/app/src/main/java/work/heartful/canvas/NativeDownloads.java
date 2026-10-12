package work.heartful.canvas;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.widget.Toast;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Bounded, chunked blob export. No storage permission or network is required. */
final class NativeDownloads {
    static final int SAVE_REQUEST = 702;
    private static final long MAX_SIZE = 512L * 1024 * 1024;
    private final Activity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile Transfer current;
    private volatile boolean closed;

    private static final class Transfer {
        final String id, name, mime;
        final long size;
        final File file;
        final JavaScriptReplyProxy reply;
        FileOutputStream output;
        long received;
        boolean choosing;
        Transfer(String id, String name, String mime, long size, File file, JavaScriptReplyProxy reply) {
            this.id=id; this.name=name; this.mime=mime; this.size=size; this.file=file; this.reply=reply;
        }
    }

    NativeDownloads(Activity activity) { this.activity=activity; }

    void receive(String raw, JavaScriptReplyProxy reply) {
        if (closed) return;
        io.execute(() -> {
            String id="";
            try {
                if (raw == null || raw.length() > 360000) throw new IOException("保存データが大きすぎます");
                JSONObject message=new JSONObject(raw);
                id=message.getString("id");
                if (!id.matches("[0-9]{1,12}")) throw new IOException("保存番号が不正です");
                String action=message.getString("action");
                if (action.equals("begin")) {
                    if (current != null) throw new IOException("前のファイルの保存を完了してください");
                    long size=message.getLong("size");
                    if (size < 0 || size > MAX_SIZE) throw new IOException("保存できるファイルは512MBまでです");
                    String name=message.optString("name","KaeruNote").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
                    if (name.length() > 180) name=name.substring(0,180);
                    if (name.trim().isEmpty()) name="KaeruNote";
                    String mime=message.optString("mime","application/octet-stream");
                    if (!mime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")) mime="application/octet-stream";
                    File file=File.createTempFile("kaeru-export-", ".tmp", activity.getCacheDir());
                    Transfer transfer=new Transfer(id,name,mime,size,file,reply);
                    current=transfer;
                    transfer.output=new FileOutputStream(file);
                    respond(reply,id,null);
                    return;
                }
                Transfer transfer=current;
                if (transfer == null || !transfer.id.equals(id)) {
                    if (action.equals("cancel")) return;
                    throw new IOException("保存処理が見つかりません");
                }
                switch (action) {
                    case "chunk":
                        if (transfer.choosing || message.getLong("offset") != transfer.received) throw new IOException("保存順序が不正です");
                        byte[] chunk=Base64.decode(message.getString("data"),Base64.DEFAULT);
                        if (chunk.length > 262144 || transfer.received+chunk.length > transfer.size) throw new IOException("保存サイズが一致しません");
                        transfer.output.write(chunk);
                        transfer.received+=chunk.length;
                        respond(reply,id,null);
                        break;
                    case "finish":
                        if (transfer.choosing || transfer.received != transfer.size) throw new IOException("ファイルの転送が完了していません");
                        transfer.output.close(); transfer.output=null; transfer.choosing=true;
                        activity.runOnUiThread(() -> {
                            if (closed || current != transfer) return;
                            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                            intent.addCategory(Intent.CATEGORY_OPENABLE);
                            intent.setType(transfer.mime);
                            intent.putExtra(Intent.EXTRA_TITLE,transfer.name);
                            try { activity.startActivityForResult(intent,SAVE_REQUEST); }
                            catch (Exception error) { io.execute(() -> fail(transfer,"保存先を開けません")); }
                        });
                        break;
                    case "cancel": cleanup(transfer); break;
                    default: throw new IOException("不明な保存操作です");
                }
            } catch (Exception error) {
                Transfer transfer=current;
                if (transfer != null && transfer.id.equals(id)) cleanup(transfer);
                String message=error.getMessage()==null?"保存できませんでした":error.getMessage();
                respond(reply,id,message);
                toast(message);
            }
        });
    }

    void result(int resultCode, Intent data) {
        Transfer transfer=current;
        if (transfer == null || !transfer.choosing) return;
        final Uri destination=data==null?null:data.getData();
        io.execute(() -> {
            if (resultCode != Activity.RESULT_OK || destination == null) {
                respond(transfer.reply,transfer.id,"保存を取り消しました"); cleanup(transfer); return;
            }
            try (FileInputStream input=new FileInputStream(transfer.file);
                 OutputStream output=activity.getContentResolver().openOutputStream(destination,"w")) {
                if (output == null) throw new IOException("保存先に書き込めません");
                byte[] buffer=new byte[65536]; int count;
                while ((count=input.read(buffer)) != -1) output.write(buffer,0,count);
                output.flush();
            } catch (Exception error) { fail(transfer,"ファイルを保存できませんでした"); return; }
            respond(transfer.reply,transfer.id,null);
            cleanup(transfer);
            toast("ファイルを保存しました");
        });
    }

    private void respond(JavaScriptReplyProxy reply, String id, String error) {
        try {
            JSONObject response=new JSONObject().put("id",id);
            if (error != null) response.put("error",error);
            String text=response.toString();
            activity.runOnUiThread(() -> { if (!closed && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(text); });
        } catch (Exception ignored) { }
    }
    private void toast(String text) { activity.runOnUiThread(() -> { if (!closed) Toast.makeText(activity,text,Toast.LENGTH_LONG).show(); }); }
    private void fail(Transfer transfer,String message) { respond(transfer.reply,transfer.id,message); cleanup(transfer); toast(message); }
    private void cleanup(Transfer transfer) {
        try { if (transfer.output != null) transfer.output.close(); } catch (IOException ignored) { }
        transfer.file.delete();
        if (current == transfer) current=null;
    }
    void close() {
        closed=true;
        io.execute(() -> { if (current != null) cleanup(current); });
        io.shutdown();
    }
}
