package work.heartful.canvas;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;
import android.widget.EditText;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/** Lightweight native spreadsheet overlay. Tap a cell to edit it. */
public final class NativeSheetView extends View {
    public interface Listener { void onSheetChanged(); }

    private static final int ROWS = 20;
    private static final int COLS = 10;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Map<String,String> cells = new HashMap<>();
    private Listener listener;
    private int selectedRow = -1, selectedCol = -1;

    public NativeSheetView(Context context) {
        super(context);
        setBackgroundColor(Color.argb(244, 255, 255, 255));
        setElevation(8f);
    }

    public void setListener(Listener listener) { this.listener = listener; }
    public Map<String,String> getCells() { return cells; }

    private float headerW() { return 48f * getResources().getDisplayMetrics().density; }
    private float headerH() { return 30f * getResources().getDisplayMetrics().density; }
    private float cellW() { return 96f * getResources().getDisplayMetrics().density; }
    private float cellH() { return 34f * getResources().getDisplayMetrics().density; }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float hw=headerW(), hh=headerH(), cw=cellW(), ch=cellH();
        paint.setTextSize(12f * getResources().getDisplayMetrics().scaledDensity);
        paint.setStrokeWidth(1f);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(238,241,245));
        canvas.drawRect(0,0,getWidth(),hh,paint);
        canvas.drawRect(0,0,hw,getHeight(),paint);

        for (int c=0;c<COLS;c++) {
            float x=hw+c*cw;
            paint.setColor(Color.rgb(90,98,108));
            canvas.drawText(colName(c),x+8,hh-8,paint);
        }
        for (int r=0;r<ROWS;r++) {
            float y=hh+r*ch;
            paint.setColor(Color.rgb(90,98,108));
            canvas.drawText(String.valueOf(r+1),8,y+22,paint);
        }

        paint.setStyle(Paint.Style.STROKE);
        paint.setColor(Color.rgb(211,217,224));
        for (int r=0;r<=ROWS;r++) {
            float y=hh+r*ch;
            canvas.drawLine(hw,y,hw+COLS*cw,y,paint);
        }
        for (int c=0;c<=COLS;c++) {
            float x=hw+c*cw;
            canvas.drawLine(x,hh,x,hh+ROWS*ch,paint);
        }

        paint.setStyle(Paint.Style.FILL);
        for (int r=0;r<ROWS;r++) for (int c=0;c<COLS;c++) {
            String key=cellKey(r,c);
            String value=displayValue(key);
            if (!value.isEmpty()) {
                paint.setColor(Color.rgb(38,43,49));
                canvas.drawText(value.length()>14?value.substring(0,14):value,
                    hw+c*cw+6, hh+r*ch+22, paint);
            }
        }

        if (selectedRow>=0 && selectedCol>=0) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2.5f);
            paint.setColor(Color.rgb(32,95,232));
            float l=hw+selectedCol*cw,t=hh+selectedRow*ch;
            canvas.drawRect(new RectF(l,t,l+cw,t+ch),paint);
        }
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (event.getActionMasked()!=MotionEvent.ACTION_UP) return true;
        float hw=headerW(),hh=headerH(),cw=cellW(),ch=cellH();
        int c=(int)((event.getX()-hw)/cw), r=(int)((event.getY()-hh)/ch);
        if (event.getX()<hw || event.getY()<hh || c<0 || c>=COLS || r<0 || r>=ROWS) return true;
        selectedRow=r; selectedCol=c; invalidate();
        editCell(r,c);
        performClick();
        return true;
    }

    @Override public boolean performClick() { super.performClick(); return true; }

    private void editCell(int row,int col) {
        String key=cellKey(row,col);
        EditText input=new EditText(getContext());
        input.setSingleLine(true);
        input.setText(cells.getOrDefault(key,""));
        input.setSelectAllOnFocus(true);
        new AlertDialog.Builder(getContext())
            .setTitle(key)
            .setView(input)
            .setNegativeButton("キャンセル",null)
            .setPositiveButton("OK",(d,w)->{
                String value=input.getText().toString();
                if(value.isEmpty()) cells.remove(key); else cells.put(key,value);
                invalidate();
                if(listener!=null) listener.onSheetChanged();
            }).show();
    }

    public String displayValue(String key) {
        String raw=cells.getOrDefault(key,"");
        if (!raw.startsWith("=")) return raw;
        String expr=raw.substring(1).trim().toUpperCase();
        try {
            if (expr.startsWith("SUM(") && expr.endsWith(")")) return fmt(sumRange(expr.substring(4,expr.length()-1)));
            if (expr.startsWith("AVERAGE(") && expr.endsWith(")")) {
                String range=expr.substring(8,expr.length()-1);
                double[] sc=sumCountRange(range);
                return fmt(sc[1]==0?0:sc[0]/sc[1]);
            }
            if (expr.matches("[A-Z]+[0-9]+")) return cells.getOrDefault(expr,"");
            return "#ERR";
        } catch(Exception e) { return "#ERR"; }
    }

    private double sumRange(String range){ return sumCountRange(range)[0]; }
    private double[] sumCountRange(String range){
        String[] p=range.split(":");
        Cell a=parseCell(p[0]); Cell b=parseCell(p.length>1?p[1]:p[0]);
        double sum=0,count=0;
        for(int r=Math.min(a.r,b.r);r<=Math.max(a.r,b.r);r++) for(int c=Math.min(a.c,b.c);c<=Math.max(a.c,b.c);c++){
            String v=displayValue(cellKey(r,c));
            try{sum+=Double.parseDouble(v.replace(",",""));count++;}catch(Exception ignored){}
        }
        return new double[]{sum,count};
    }

    public double numericAt(int row,int col){
        try{return Double.parseDouble(displayValue(cellKey(row,col)).replace(",",""));}catch(Exception e){return Double.NaN;}
    }
    public String textAt(int row,int col){return displayValue(cellKey(row,col));}

    public void writeTo(DataOutputStream out) throws IOException {
        out.writeInt(cells.size());
        for(Map.Entry<String,String> e:cells.entrySet()){out.writeUTF(e.getKey());out.writeUTF(e.getValue());}
    }
    public void readFrom(DataInputStream in) throws IOException {
        cells.clear(); int n=in.readInt();
        if(n<0||n>5000) throw new IOException("bad sheet");
        for(int i=0;i<n;i++) cells.put(in.readUTF(),in.readUTF());
        invalidate();
    }

    private static final class Cell { final int r,c; Cell(int r,int c){this.r=r;this.c=c;} }
    private static Cell parseCell(String key){
        key=key.trim().toUpperCase(); int i=0,c=0;
        while(i<key.length()&&Character.isLetter(key.charAt(i))){c=c*26+(key.charAt(i)-'A'+1);i++;}
        int r=Integer.parseInt(key.substring(i));
        return new Cell(r-1,c-1);
    }
    private static String colName(int index){String s="";int n=index+1;while(n>0){n--;s=(char)('A'+n%26)+s;n/=26;}return s;}
    private static String cellKey(int r,int c){return colName(c)+(r+1);}
    private static String fmt(double v){if(Math.rint(v)==v)return Long.toString((long)v);return String.format(java.util.Locale.US,"%.4f",v).replaceAll("0+$","").replaceAll("\\.$","");}
}
