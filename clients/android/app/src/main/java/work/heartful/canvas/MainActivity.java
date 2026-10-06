package work.heartful.canvas;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;

public class MainActivity extends Activity {
    private static final int PICK_IMAGE = 4101;
    private NativeCanvasView canvas;
    private Button penButton, eraserButton, gridButton, layersButton, noteButton, sheetButton, chartButton;
    private TextView hint;
    private File autosave, studioSave;
    private NativeCanvasView.Tool toolBeforeSpace;
    private FrameLayout root;
    private EditText fixedNote;
    private NativeSheetView sheetView;
    private NativeChartView chartView;
    private LinearLayout layerPanel;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindowColors();
        autosave = new File(getFilesDir(), "native-canvas-v1.bin");
        studioSave = new File(getFilesDir(), "native-studio-v1.bin");

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(250,250,248));

        canvas = new NativeCanvasView(this);
        root.addView(canvas, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        sheetView = new NativeSheetView(this);
        sheetView.setVisibility(View.GONE);
        sheetView.setListener(() -> { chartView.invalidate(); saveStudio(); });
        FrameLayout.LayoutParams sheetLp=new FrameLayout.LayoutParams(dp(880),dp(520),Gravity.TOP|Gravity.START);
        sheetLp.leftMargin=dp(72); sheetLp.topMargin=dp(64);
        root.addView(sheetView,sheetLp);

        chartView = new NativeChartView(this);
        chartView.setSheet(sheetView);
        chartView.setVisibility(View.GONE);
        FrameLayout.LayoutParams chartLp=new FrameLayout.LayoutParams(dp(420),dp(280),Gravity.TOP|Gravity.END);
        chartLp.rightMargin=dp(28); chartLp.topMargin=dp(70);
        root.addView(chartView,chartLp);

        fixedNote = new EditText(this);
        fixedNote.setGravity(Gravity.TOP|Gravity.START);
        fixedNote.setTextSize(17);
        fixedNote.setTextColor(Color.rgb(36,39,43));
        fixedNote.setHint("固定ノート。拡大・縮小しても画面に固定されます。");
        fixedNote.setPadding(dp(42),dp(48),dp(42),dp(100));
        fixedNote.setBackgroundColor(Color.argb(244,255,255,255));
        fixedNote.setVisibility(View.GONE);
        fixedNote.setSingleLine(false);
        fixedNote.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE|android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        root.addView(fixedNote,new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout toolbar=buildToolbar();
        FrameLayout.LayoutParams toolsLayout=new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,ViewGroup.LayoutParams.WRAP_CONTENT,Gravity.BOTTOM|Gravity.CENTER_HORIZONTAL);
        toolsLayout.bottomMargin=dp(18);
        root.addView(toolbar,toolsLayout);

        hint=new TextView(this);
        hint.setTextSize(11); hint.setTextColor(Color.rgb(98,105,114)); hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(10),dp(6),dp(10),dp(6));
        GradientDrawable hintBg=new GradientDrawable(); hintBg.setColor(Color.argb(220,255,255,255)); hintBg.setCornerRadius(dp(12)); hint.setBackground(hintBg);
        FrameLayout.LayoutParams hintLayout=new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,ViewGroup.LayoutParams.WRAP_CONTENT,Gravity.TOP|Gravity.CENTER_HORIZONTAL);
        hintLayout.topMargin=dp(12); root.addView(hint,hintLayout);

        layerPanel=buildLayerPanel();
        layerPanel.setVisibility(View.GONE);
        FrameLayout.LayoutParams panelLp=new FrameLayout.LayoutParams(dp(250),ViewGroup.LayoutParams.MATCH_PARENT,Gravity.END);
        root.addView(layerPanel,panelLp);

        if(Build.VERSION.SDK_INT>=30){
            root.setOnApplyWindowInsetsListener((view,insets)->{
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
                return insets;
            });
        }

        setContentView(root);
        applySystemBarAppearance();
        canvas.load(autosave);
        loadStudio();
        canvas.requestFocus();
        updateToolButtons();
    }

    private LinearLayout buildToolbar(){
        LinearLayout bar=new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL); bar.setGravity(Gravity.CENTER); bar.setPadding(dp(6),dp(6),dp(6),dp(6));
        GradientDrawable bg=new GradientDrawable(); bg.setColor(Color.argb(242,255,255,255)); bg.setCornerRadius(dp(18)); bg.setStroke(dp(1),Color.rgb(224,226,229)); bar.setBackground(bg); bar.setElevation(dp(7));
        penButton=addToolButton(bar,"ペン",v->selectTool(NativeCanvasView.Tool.PEN));
        eraserButton=addToolButton(bar,"消し",v->selectTool(NativeCanvasView.Tool.ERASER));
        addToolButton(bar,"戻す",v->canvas.undo());
        addToolButton(bar,"進む",v->canvas.redo());
        gridButton=addToolButton(bar,"方眼",v->{canvas.setGridEnabled(!canvas.isGridEnabled());updateToolButtons();});
        noteButton=addToolButton(bar,"ノート",v->toggleFixedNote());
        addToolButton(bar,"画像",v->pickImage());
        sheetButton=addToolButton(bar,"表",v->toggleSheet());
        chartButton=addToolButton(bar,"グラフ",v->toggleChart());
        layersButton=addToolButton(bar,"レイヤー",v->toggleLayers());
        return bar;
    }

    private LinearLayout buildLayerPanel(){
        LinearLayout panel=new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setPadding(dp(10),dp(48),dp(10),dp(12)); panel.setBackgroundColor(Color.rgb(244,245,247)); panel.setElevation(dp(12));
        TextView title=new TextView(this); title.setText("レイヤー"); title.setTextSize(16); title.setTextColor(Color.rgb(40,46,54)); title.setPadding(dp(6),0,0,dp(12)); panel.addView(title);
        addPanelButton(panel,"固定ノート",v->toggleFixedNote());
        addPanelButton(panel,"描画 1  表示/非表示",v->{canvas.setDrawingVisible(!canvas.isDrawingVisible());updateToolButtons();});
        addPanelButton(panel,"画像  表示/非表示",v->{canvas.setImagesVisible(!canvas.isImagesVisible());updateToolButtons();});
        addPanelButton(panel,"表計算  表示/非表示",v->toggleSheet());
        addPanelButton(panel,"グラフ  表示/非表示",v->toggleChart());
        addPanelButton(panel,"グラフ種類を変更",v->{chartView.cycleType();updateToolButtons();});
        return panel;
    }

    private Button addPanelButton(LinearLayout panel,String label,View.OnClickListener listener){
        Button b=new Button(this); b.setText(label); b.setAllCaps(false); b.setTextSize(12); b.setOnClickListener(listener);
        panel.addView(b,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT));
        return b;
    }

    private Button addToolButton(LinearLayout bar,String label,View.OnClickListener listener){
        Button b=new Button(this); b.setText(label); b.setTextSize(12); b.setTextColor(Color.rgb(33,38,44)); b.setAllCaps(false);
        b.setMinWidth(0);b.setMinimumWidth(0);b.setMinHeight(0);b.setMinimumHeight(0);b.setPadding(dp(10),dp(8),dp(10),dp(8));
        b.setBackground(makeButtonBackground(false)); b.setOnClickListener(listener);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,ViewGroup.LayoutParams.WRAP_CONTENT);p.setMargins(dp(1),0,dp(1),0);bar.addView(b,p);return b;
    }

    private void toggleFixedNote(){
        boolean show=fixedNote.getVisibility()!=View.VISIBLE;
        fixedNote.setVisibility(show?View.VISIBLE:View.GONE);
        if(show){fixedNote.bringToFront();fixedNote.requestFocus();}else canvas.requestFocus();
        bringChromeToFront(); updateToolButtons();
    }
    private void toggleSheet(){sheetView.setVisibility(sheetView.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);sheetView.bringToFront();bringChromeToFront();updateToolButtons();}
    private void toggleChart(){chartView.setVisibility(chartView.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);chartView.bringToFront();bringChromeToFront();updateToolButtons();}
    private void toggleLayers(){layerPanel.setVisibility(layerPanel.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);layerPanel.bringToFront();updateToolButtons();}
    private void bringChromeToFront(){ if(hint!=null)hint.bringToFront(); if(layerPanel!=null&&layerPanel.getVisibility()==View.VISIBLE)layerPanel.bringToFront(); }

    private void pickImage(){
        Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("image/*");startActivityForResult(i,PICK_IMAGE);
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode!=PICK_IMAGE||resultCode!=RESULT_OK||data==null||data.getData()==null)return;
        Uri uri=data.getData();
        try(InputStream in=getContentResolver().openInputStream(uri)){
            File dir=new File(getFilesDir(),"images"); if(!dir.exists())dir.mkdirs();
            File out=new File(dir,"img-"+System.currentTimeMillis()+".bin");
            try(FileOutputStream fos=new FileOutputStream(out)){byte[] buf=new byte[65536];int n;while((n=in.read(buf))>0)fos.write(buf,0,n);}
            canvas.addImageFile(out); canvas.requestFocus();
        }catch(Exception e){ if(hint!=null)hint.setText("画像の読み込みに失敗: "+e.getMessage()); }
    }

    private void selectTool(NativeCanvasView.Tool tool){fixedNote.setVisibility(View.GONE);canvas.setTool(tool);canvas.requestFocus();updateToolButtons();}

    private void updateToolButtons(){
        NativeCanvasView.Tool tool=canvas.getTool();
        boolean pen=tool==NativeCanvasView.Tool.PEN||tool==NativeCanvasView.Tool.VECTOR_PEN, eraser=tool==NativeCanvasView.Tool.ERASER;
        setSelected(penButton,pen);setSelected(eraserButton,eraser);setSelected(gridButton,canvas.isGridEnabled());
        setSelected(noteButton,fixedNote.getVisibility()==View.VISIBLE);setSelected(sheetButton,sheetView.getVisibility()==View.VISIBLE);
        setSelected(chartButton,chartView.getVisibility()==View.VISIBLE);setSelected(layersButton,layerPanel.getVisibility()==View.VISIBLE);
        if(hint!=null) hint.setText(canvas.getToolDisplayName()+"    Sペン側面: 消しゴム    Ctrl+側面: オブジェクト削除    グラフ:"+chartView.getTypeLabel());
    }
    private void setSelected(Button b,boolean on){if(b==null)return;b.setBackground(makeButtonBackground(on));b.setTextColor(on?Color.WHITE:Color.rgb(33,38,44));}
    private GradientDrawable makeButtonBackground(boolean selected){GradientDrawable s=new GradientDrawable();s.setColor(selected?Color.rgb(32,95,232):Color.TRANSPARENT);s.setCornerRadius(dp(12));return s;}

    private void configureWindowColors(){Window w=getWindow();w.setStatusBarColor(Color.rgb(250,250,248));w.setNavigationBarColor(Color.rgb(250,250,248));if(Build.VERSION.SDK_INT<30)w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);}
    private void applySystemBarAppearance(){if(Build.VERSION.SDK_INT<30)return;View decor=getWindow().getDecorView();decor.post(()->{WindowInsetsController c=decor.getWindowInsetsController();if(c!=null){int mask=WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;c.setSystemBarsAppearance(mask,mask);}});}

    @Override public boolean dispatchKeyEvent(KeyEvent event){
        if(canvas==null)return super.dispatchKeyEvent(event);
        if(fixedNote.getVisibility()==View.VISIBLE && fixedNote.hasFocus()) return super.dispatchKeyEvent(event);
        int action=event.getAction(),code=event.getKeyCode();boolean down=action==KeyEvent.ACTION_DOWN,ctrl=event.isCtrlPressed(),shift=event.isShiftPressed();
        if(code==KeyEvent.KEYCODE_CTRL_LEFT||code==KeyEvent.KEYCODE_CTRL_RIGHT){canvas.setCtrlPressed(down);return true;}
        if(code==KeyEvent.KEYCODE_SPACE){if(down&&event.getRepeatCount()==0){toolBeforeSpace=canvas.getTool();canvas.setTool(NativeCanvasView.Tool.HAND);updateToolButtons();}else if(!down&&toolBeforeSpace!=null){canvas.setTool(toolBeforeSpace);toolBeforeSpace=null;updateToolButtons();}return true;}
        if(!down)return super.dispatchKeyEvent(event);
        if(ctrl){switch(code){case KeyEvent.KEYCODE_A:canvas.selectAll();return true;case KeyEvent.KEYCODE_D:canvas.clearSelection();return true;case KeyEvent.KEYCODE_C:canvas.copySelection();return true;case KeyEvent.KEYCODE_X:canvas.cutSelection();return true;case KeyEvent.KEYCODE_V:canvas.pasteSelection();return true;case KeyEvent.KEYCODE_Z:if(shift)canvas.redo();else canvas.undo();return true;default:break;}}
        switch(code){
            case KeyEvent.KEYCODE_B:selectTool(NativeCanvasView.Tool.PEN);return true;
            case KeyEvent.KEYCODE_E:selectTool(NativeCanvasView.Tool.ERASER);return true;
            case KeyEvent.KEYCODE_M:selectTool(canvas.getTool()==NativeCanvasView.Tool.RECT_SELECT?NativeCanvasView.Tool.ELLIPSE_SELECT:NativeCanvasView.Tool.RECT_SELECT);return true;
            case KeyEvent.KEYCODE_L:selectTool(NativeCanvasView.Tool.LASSO_SELECT);return true;
            case KeyEvent.KEYCODE_W:selectTool(NativeCanvasView.Tool.QUICK_SELECT);return true;
            case KeyEvent.KEYCODE_G:selectTool(NativeCanvasView.Tool.FILL);return true;
            case KeyEvent.KEYCODE_V:selectTool(NativeCanvasView.Tool.MOVE);return true;
            case KeyEvent.KEYCODE_P:selectTool(NativeCanvasView.Tool.VECTOR_PEN);return true;
            case KeyEvent.KEYCODE_H:selectTool(NativeCanvasView.Tool.HAND);return true;
            case KeyEvent.KEYCODE_Z:selectTool(NativeCanvasView.Tool.ZOOM);return true;
            case KeyEvent.KEYCODE_I:selectTool(NativeCanvasView.Tool.EYEDROPPER);return true;
            case KeyEvent.KEYCODE_LEFT_BRACKET:canvas.adjustBrushSize(-1);return true;
            case KeyEvent.KEYCODE_RIGHT_BRACKET:canvas.adjustBrushSize(1);return true;
            case KeyEvent.KEYCODE_DEL:case KeyEvent.KEYCODE_FORWARD_DEL:canvas.deleteSelection();return true;
            default:return super.dispatchKeyEvent(event);
        }
    }

    private void saveStudio(){
        try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(studioSave)))){
            out.writeInt(0x53545531);out.writeUTF(fixedNote.getText().toString());out.writeBoolean(sheetView.getVisibility()==View.VISIBLE);out.writeBoolean(chartView.getVisibility()==View.VISIBLE);sheetView.writeTo(out);
        }catch(Exception ignored){}
    }
    private void loadStudio(){
        if(!studioSave.isFile())return;
        try(DataInputStream in=new DataInputStream(new BufferedInputStream(new FileInputStream(studioSave)))){
            if(in.readInt()!=0x53545531)return;fixedNote.setText(in.readUTF());sheetView.setVisibility(in.readBoolean()?View.VISIBLE:View.GONE);chartView.setVisibility(in.readBoolean()?View.VISIBLE:View.GONE);sheetView.readFrom(in);
        }catch(Exception ignored){}
    }

    private int dp(float v){return Math.round(v*getResources().getDisplayMetrics().density);}
    @Override protected void onPause(){if(canvas!=null&&autosave!=null)canvas.save(autosave);saveStudio();super.onPause();}
}
