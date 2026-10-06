package work.heartful.canvas;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

/** Native chart overlay backed by the spreadsheet's first two columns. */
public final class NativeChartView extends View {
    public enum Type { BAR, LINE, PIE }
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private NativeSheetView sheet;
    private Type type=Type.BAR;

    public NativeChartView(Context context){super(context);setBackgroundColor(Color.argb(245,255,255,255));setElevation(10f);}
    public void setSheet(NativeSheetView sheet){this.sheet=sheet;invalidate();}
    public Type getType(){return type;}
    public void cycleType(){type=type==Type.BAR?Type.LINE:type==Type.LINE?Type.PIE:Type.BAR;invalidate();}
    public String getTypeLabel(){return type==Type.BAR?"棒":type==Type.LINE?"折線":"円";}

    @Override protected void onDraw(Canvas c){
        super.onDraw(c); if(sheet==null)return;
        int n=0; double max=0,total=0; double[] vals=new double[20];
        for(int r=0;r<20;r++){double v=sheet.numericAt(r,1);if(Double.isNaN(v))continue;vals[n++]=v;max=Math.max(max,Math.abs(v));total+=Math.abs(v);}
        paint.setTextSize(13f*getResources().getDisplayMetrics().scaledDensity);paint.setColor(Color.rgb(70,78,88));paint.setStyle(Paint.Style.FILL);
        c.drawText("グラフ ("+getTypeLabel()+")",12,20,paint);
        if(n==0){c.drawText("A列=ラベル / B列=数値",12,44,paint);return;}
        float l=26,t=34,r=getWidth()-18,b=getHeight()-24,w=r-l,h=b-t;max=Math.max(1,max);
        paint.setStrokeWidth(3f);paint.setColor(Color.rgb(65,107,150));
        if(type==Type.BAR){
            float gap=w/n;
            for(int i=0;i<n;i++){float bh=(float)(Math.abs(vals[i])/max*h);paint.setStyle(Paint.Style.FILL);paint.setColor(Color.rgb(106,142,181));c.drawRect(l+i*gap+4,b-bh,l+(i+1)*gap-4,b,paint);}
        } else if(type==Type.LINE){
            Path p=new Path();for(int i=0;i<n;i++){float x=l+(n==1?0:i*w/(n-1));float y=b-(float)(Math.abs(vals[i])/max*h);if(i==0)p.moveTo(x,y);else p.lineTo(x,y);}paint.setStyle(Paint.Style.STROKE);c.drawPath(p,paint);
        } else {
            float cx=(l+r)/2,cy=(t+b)/2,rad=Math.min(w,h)*.38f,start=-90f;paint.setStyle(Paint.Style.FILL);
            for(int i=0;i<n;i++){float sweep=(float)(Math.abs(vals[i])/Math.max(1e-9,total)*360f);paint.setColor(Color.rgb(70+(i*37)%130,100+(i*53)%120,130+(i*29)%110));c.drawArc(cx-rad,cy-rad,cx+rad,cy+rad,start,sweep,true,paint);start+=sweep;}
        }
    }
}
