package work.heartful.canvas;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
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
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;

public class MainActivity extends Activity {
    private static final int PICK_IMAGE = 4101;
    private static final String PREFS = "native-notes-v1";
    private static final String PREF_ORDER = "note-order";
    private static final String PREF_CURRENT = "current-note";

    private NativeCanvasView canvas;
    private Button penButton, eraserButton, gridButton, layersButton, noteButton, sheetButton, chartButton;
    private TextView hint;
    private NativeCanvasView.Tool toolBeforeSpace;
    private FrameLayout root;
    private EditText fixedNote;
    private NativeSheetView sheetView;
    private NativeChartView chartView;
    private LinearLayout layerPanel;
    private LinearLayout noteListPanel;
    private LinearLayout noteListContainer;
    private Button noteListToggle;
    private Button layerPanelToggle;
    private final ArrayList<String> noteIds = new ArrayList<>();
    private String currentNoteId = "";
    private SharedPreferences prefs;
    private boolean loadingNote = false;

    private final Handler autosaveHandler = new Handler(Looper.getMainLooper());
    private final Runnable autosaveTick = new Runnable() {
        @Override public void run() {
            if (!isFinishing()) saveCurrentNote();
            autosaveHandler.postDelayed(this, 1800);
        }
    };
    private final Runnable autosaveSoon = this::saveCurrentNote;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindowColors();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(250,250,248));

        canvas = new NativeCanvasView(this);
        root.addView(canvas, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        sheetView = new NativeSheetView(this);
        sheetView.setVisibility(View.GONE);
        sheetView.setListener(() -> { chartView.invalidate(); scheduleAutosave(); });
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
        fixedNote.setHint("メモを書き始める…");
        fixedNote.setPadding(dp(42),dp(48),dp(42),dp(100));
        fixedNote.setBackgroundColor(Color.argb(244,255,255,255));
        fixedNote.setVisibility(View.GONE);
        fixedNote.setSingleLine(false);
        if (Build.VERSION.SDK_INT >= 33) {
            fixedNote.setAutoHandwritingEnabled(false);
        }
        fixedNote.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
            | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        fixedNote.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            @Override public void onTextChanged(CharSequence s,int start,int before,int count){
                if(!loadingNote){ scheduleAutosave(); refreshNoteList(); }
            }
            @Override public void afterTextChanged(Editable s){}
        });
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

        noteListPanel=buildNoteListPanel();
        FrameLayout.LayoutParams notePanelLp=new FrameLayout.LayoutParams(dp(286),ViewGroup.LayoutParams.MATCH_PARENT,Gravity.START);
        root.addView(noteListPanel,notePanelLp);

        noteListToggle=new Button(this);
        noteListToggle.setText("☰");
        noteListToggle.setTextSize(19);
        noteListToggle.setAllCaps(false);
        noteListToggle.setMinWidth(0); noteListToggle.setMinimumWidth(0);
        noteListToggle.setPadding(dp(10),dp(4),dp(10),dp(4));
        noteListToggle.setOnClickListener(v->toggleNoteList());
        FrameLayout.LayoutParams listToggleLp=new FrameLayout.LayoutParams(dp(48),dp(42),Gravity.TOP|Gravity.START);
        listToggleLp.leftMargin=dp(8); listToggleLp.topMargin=dp(8);
        root.addView(noteListToggle,listToggleLp);

        layerPanelToggle=new Button(this);
        layerPanelToggle.setText("☷ レイヤー");
        layerPanelToggle.setTextSize(11);
        layerPanelToggle.setAllCaps(false);
        layerPanelToggle.setMinWidth(0); layerPanelToggle.setMinimumWidth(0);
        layerPanelToggle.setPadding(dp(10),dp(4),dp(10),dp(4));
        layerPanelToggle.setOnClickListener(v->toggleLayers());
        FrameLayout.LayoutParams layerToggleLp=new FrameLayout.LayoutParams(dp(92),dp(42),Gravity.TOP|Gravity.END);
        layerToggleLp.rightMargin=dp(8); layerToggleLp.topMargin=dp(8);
        root.addView(layerPanelToggle,layerToggleLp);

        if(Build.VERSION.SDK_INT>=30){
            root.setOnApplyWindowInsetsListener((view,insets)->{
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
                return insets;
            });
        }

        setContentView(root);
        applySystemBarAppearance();
        initializeNotes();
        boolean tablet=getResources().getDisplayMetrics().widthPixels/getResources().getDisplayMetrics().density>=700f;
        noteListPanel.setVisibility(tablet?View.VISIBLE:View.GONE);
        bringChromeToFront();
        canvas.requestFocus();
        updateToolButtons();
    }

    private LinearLayout buildToolbar(){
        LinearLayout bar=new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL); bar.setGravity(Gravity.CENTER); bar.setPadding(dp(6),dp(6),dp(6),dp(6));
        GradientDrawable bg=new GradientDrawable(); bg.setColor(Color.argb(242,255,255,255)); bg.setCornerRadius(dp(18)); bg.setStroke(dp(1),Color.rgb(224,226,229)); bar.setBackground(bg); bar.setElevation(dp(7));
        penButton=addToolButton(bar,"ペン",v->selectTool(NativeCanvasView.Tool.PEN));
        eraserButton=addToolButton(bar,"消し",v->selectTool(NativeCanvasView.Tool.ERASER));
        addToolButton(bar,"戻す",v->{canvas.undo();scheduleAutosave();});
        addToolButton(bar,"進む",v->{canvas.redo();scheduleAutosave();});
        gridButton=addToolButton(bar,"方眼",v->{canvas.setGridEnabled(!canvas.isGridEnabled());updateToolButtons();scheduleAutosave();});
        noteButton=addToolButton(bar,"ノート",v->toggleFixedNote());
        addToolButton(bar,"画像",v->pickImage());
        sheetButton=addToolButton(bar,"表",v->toggleSheet());
        chartButton=addToolButton(bar,"グラフ",v->toggleChart());
        layersButton=addToolButton(bar,"レイヤー",v->toggleLayers());
        return bar;
    }

    private LinearLayout buildLayerPanel(){
        LinearLayout panel=new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setPadding(dp(10),dp(48),dp(10),dp(12)); panel.setBackgroundColor(Color.rgb(244,245,247)); panel.setElevation(dp(12));
        LinearLayout head=new LinearLayout(this); head.setOrientation(LinearLayout.HORIZONTAL); head.setGravity(Gravity.CENTER_VERTICAL);
        TextView title=new TextView(this); title.setText("レイヤー"); title.setTextSize(18); title.setTextColor(Color.rgb(40,46,54)); title.setTypeface(null,android.graphics.Typeface.BOLD);
        head.addView(title,new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));
        Button close=new Button(this); close.setText("×"); close.setTextSize(20); close.setAllCaps(false); close.setMinWidth(0); close.setMinimumWidth(0); close.setOnClickListener(v->toggleLayers());
        head.addView(close,new LinearLayout.LayoutParams(dp(48),dp(42))); panel.addView(head);
        addPanelButton(panel,"固定ノート",v->toggleFixedNote());
        addPanelButton(panel,"描画 1  表示/非表示",v->{canvas.setDrawingVisible(!canvas.isDrawingVisible());updateToolButtons();scheduleAutosave();});
        addPanelButton(panel,"画像  表示/非表示",v->{canvas.setImagesVisible(!canvas.isImagesVisible());updateToolButtons();scheduleAutosave();});
        addPanelButton(panel,"表計算  表示/非表示",v->toggleSheet());
        addPanelButton(panel,"グラフ  表示/非表示",v->toggleChart());
        addPanelButton(panel,"グラフ種類を変更",v->{chartView.cycleType();updateToolButtons();scheduleAutosave();});
        return panel;
    }

    private LinearLayout buildNoteListPanel(){
        LinearLayout panel=new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(10),dp(52),dp(10),dp(12));
        panel.setBackgroundColor(Color.rgb(246,247,249));
        panel.setElevation(dp(14));

        LinearLayout head=new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL); head.setGravity(Gravity.CENTER_VERTICAL);
        TextView title=new TextView(this); title.setText("メモ"); title.setTextSize(22); title.setTextColor(Color.rgb(28,32,38)); title.setTypeface(null,android.graphics.Typeface.BOLD);
        head.addView(title,new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));
        Button classify=new Button(this); classify.setText("分類"); classify.setTextSize(11); classify.setAllCaps(false); classify.setMinWidth(0); classify.setMinimumWidth(0); classify.setOnClickListener(v->editCurrentMetadata());
        head.addView(classify,new LinearLayout.LayoutParams(dp(58),dp(44)));
        Button add=new Button(this); add.setText("＋"); add.setTextSize(24); add.setAllCaps(false); add.setMinWidth(0); add.setMinimumWidth(0); add.setOnClickListener(v->createNewNote());
        head.addView(add,new LinearLayout.LayoutParams(dp(48),dp(44)));
        Button close=new Button(this); close.setText("×"); close.setTextSize(20); close.setAllCaps(false); close.setMinWidth(0); close.setMinimumWidth(0); close.setOnClickListener(v->toggleNoteList());
        head.addView(close,new LinearLayout.LayoutParams(dp(44),dp(44)));
        panel.addView(head);

        TextView sub=new TextView(this); sub.setText("自動保存"); sub.setTextSize(11); sub.setTextColor(Color.rgb(125,132,141)); sub.setPadding(dp(2),0,0,dp(8)); panel.addView(sub);

        ScrollView scroll=new ScrollView(this);
        noteListContainer=new LinearLayout(this); noteListContainer.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(noteListContainer,new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(scroll,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1));
        return panel;
    }

    private void refreshNoteList(){
        if(noteListContainer==null)return;
        noteListContainer.removeAllViews();
        for(String id:noteIds){
            LinearLayout row=new LinearLayout(this); row.setOrientation(LinearLayout.VERTICAL); row.setPadding(dp(14),dp(10),dp(10),dp(10));
            int accent=noteColor(id);
            GradientDrawable bg=new GradientDrawable(); bg.setCornerRadius(dp(10)); bg.setColor(id.equals(currentNoteId)?blendWithWhite(accent,0.80f):blendWithWhite(accent,0.92f)); bg.setStroke(dp(id.equals(currentNoteId)?2:1),accent); row.setBackground(bg);
            TextView title=new TextView(this); title.setText(titleFor(id)); title.setTextSize(15); title.setTextColor(Color.rgb(34,39,46)); title.setMaxLines(1);
            String category=categoryFor(id), tags=tagsFor(id);
            StringBuilder info=new StringBuilder();
            if(!category.isEmpty()) info.append("● ").append(category);
            if(!tags.isEmpty()){ if(info.length()>0)info.append("   "); for(String tag:tags.split(",")){String t=tag.trim();if(!t.isEmpty())info.append("#").append(t).append(" ");} }
            if(info.length()==0) info.append(id.equals(currentNoteId)?"編集中・自動保存":"未分類");
            TextView meta=new TextView(this); meta.setText(info.toString().trim()); meta.setTextSize(10); meta.setTextColor(accent); meta.setPadding(0,dp(3),0,0); meta.setMaxLines(2);
            row.addView(title); row.addView(meta);
            row.setOnClickListener(v->switchNote(id));
            row.setOnLongClickListener(v->{editMetadata(id);return true;});
            LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT);lp.setMargins(0,0,0,dp(4));noteListContainer.addView(row,lp);
        }
    }

    private void initializeNotes(){
        noteIds.clear();
        String order=prefs.getString(PREF_ORDER,"");
        if(order!=null&&!order.trim().isEmpty()){
            Set<String> unique=new LinkedHashSet<>();
            for(String id:order.split(",")) if(!id.trim().isEmpty()) unique.add(id.trim());
            noteIds.addAll(unique);
        }
        if(noteIds.isEmpty()){
            String id=newNoteId();
            noteIds.add(id);
            prefs.edit().putString(PREF_ORDER,id).putString(PREF_CURRENT,id).apply();
        }
        String wanted=prefs.getString(PREF_CURRENT,noteIds.get(0));
        currentNoteId=noteIds.contains(wanted)?wanted:noteIds.get(0);
        loadNote(currentNoteId,true);
        persistNoteOrder();
        refreshNoteList();
    }

    private void createNewNote(){
        saveCurrentNote();
        String id=newNoteId();
        noteIds.add(0,id);
        currentNoteId=id;
        persistNoteOrder();
        prefs.edit().putString(PREF_CURRENT,id).apply();
        loadNote(id,false);
        fixedNote.setVisibility(View.GONE);
        canvas.requestFocus();
        bringChromeToFront(); refreshNoteList(); updateToolButtons();
    }

    private void switchNote(String id){
        if(id==null||id.equals(currentNoteId))return;
        saveCurrentNote();
        currentNoteId=id;
        prefs.edit().putString(PREF_CURRENT,id).apply();
        loadNote(id,false);
        refreshNoteList();
        updateToolButtons();
        canvas.requestFocus();
    }

    private void loadNote(String id,boolean allowLegacy){
        loadingNote=true;
        canvas.clearDocument();
        fixedNote.setText("");
        sheetView.getCells().clear(); sheetView.invalidate();
        sheetView.setVisibility(View.GONE); chartView.setVisibility(View.GONE);

        File c=canvasFile(id), s=studioFile(id);
        if(c.isFile()) canvas.load(c);
        else if(allowLegacy){
            File legacy=new File(getFilesDir(),"native-canvas-v1.bin");
            if(legacy.isFile()) canvas.load(legacy);
        }
        if(s.isFile()) loadStudio(s);
        else if(allowLegacy){
            File legacy=new File(getFilesDir(),"native-studio-v1.bin");
            if(legacy.isFile()) loadStudio(legacy);
        }
        loadingNote=false;
        refreshNoteList();
    }

    private void saveCurrentNote(){
        if(loadingNote||currentNoteId==null||currentNoteId.isEmpty()||canvas==null)return;
        canvas.save(canvasFile(currentNoteId));
        saveStudio(studioFile(currentNoteId));
        String title=deriveCurrentTitle();
        String old=prefs.getString("title-"+currentNoteId,"");
        if(!title.equals(old)){
            prefs.edit().putString("title-"+currentNoteId,title).apply();
            refreshNoteList();
        }
    }

    private void scheduleAutosave(){
        if(loadingNote)return;
        autosaveHandler.removeCallbacks(autosaveSoon);
        autosaveHandler.postDelayed(autosaveSoon,650);
    }

    private String deriveCurrentTitle(){
        String text=fixedNote.getText()==null?"":fixedNote.getText().toString().trim();
        if(!text.isEmpty()){
            int cut=text.indexOf('\n'); String first=cut>=0?text.substring(0,cut):text;
            first=first.trim(); if(first.length()>32)first=first.substring(0,32);
            if(!first.isEmpty())return first;
        }
        return "新しいメモ";
    }
    private String titleFor(String id){return prefs.getString("title-"+id,"新しいメモ");}
    private String newNoteId(){return Long.toString(System.currentTimeMillis(),36);}
    private File canvasFile(String id){return new File(getFilesDir(),"note-"+id+"-canvas.bin");}
    private File studioFile(String id){return new File(getFilesDir(),"note-"+id+"-studio.bin");}
    private void persistNoteOrder(){
        StringBuilder b=new StringBuilder(); for(String id:noteIds){if(b.length()>0)b.append(',');b.append(id);}
        prefs.edit().putString(PREF_ORDER,b.toString()).apply();
    }

    private String categoryFor(String id){return prefs.getString("category-"+id,"");}
    private String tagsFor(String id){return prefs.getString("tags-"+id,"");}

    private void editCurrentMetadata(){ if(currentNoteId!=null&&!currentNoteId.isEmpty()) editMetadata(currentNoteId); }

    private void editMetadata(String id){
        LinearLayout box=new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(22),dp(8),dp(22),0);
        EditText category=new EditText(this); category.setHint("カテゴリー"); category.setSingleLine(true); category.setText(categoryFor(id));
        EditText tags=new EditText(this); tags.setHint("タグ（カンマ区切り）"); tags.setSingleLine(true); tags.setText(tagsFor(id));
        if(Build.VERSION.SDK_INT>=33){category.setAutoHandwritingEnabled(false);tags.setAutoHandwritingEnabled(false);}
        box.addView(category); box.addView(tags);
        new AlertDialog.Builder(this).setTitle(titleFor(id)+" の分類").setView(box)
            .setNegativeButton("キャンセル",null)
            .setPositiveButton("保存",(d,w)->{
                prefs.edit().putString("category-"+id,category.getText().toString().trim())
                    .putString("tags-"+id,tags.getText().toString().trim()).apply();
                refreshNoteList();
            }).show();
    }

    private int noteColor(String id){
        String category=categoryFor(id);
        int seed=(category.isEmpty()?id:category).hashCode();
        int[] colors={
            Color.rgb(230,143,34), Color.rgb(55,126,184), Color.rgb(68,150,96),
            Color.rgb(171,91,168), Color.rgb(203,92,86), Color.rgb(73,147,157)
        };
        return colors[Math.floorMod(seed,colors.length)];
    }

    private static int blendWithWhite(int color,float whiteAmount){
        whiteAmount=Math.max(0f,Math.min(1f,whiteAmount));
        int r=(int)(Color.red(color)*(1f-whiteAmount)+255f*whiteAmount);
        int g=(int)(Color.green(color)*(1f-whiteAmount)+255f*whiteAmount);
        int b=(int)(Color.blue(color)*(1f-whiteAmount)+255f*whiteAmount);
        return Color.rgb(r,g,b);
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
        bringChromeToFront(); updateToolButtons(); scheduleAutosave();
    }
    private void toggleSheet(){sheetView.setVisibility(sheetView.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);sheetView.bringToFront();bringChromeToFront();updateToolButtons();scheduleAutosave();}
    private void toggleChart(){chartView.setVisibility(chartView.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);chartView.bringToFront();bringChromeToFront();updateToolButtons();scheduleAutosave();}
    private void toggleLayers(){layerPanel.setVisibility(layerPanel.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);layerPanel.bringToFront();updateToolButtons();}
    private void toggleNoteList(){noteListPanel.setVisibility(noteListPanel.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);bringChromeToFront();}
    private void bringChromeToFront(){
        if(noteListPanel!=null&&noteListPanel.getVisibility()==View.VISIBLE)noteListPanel.bringToFront();
        if(noteListToggle!=null)noteListToggle.bringToFront();
        if(layerPanelToggle!=null)layerPanelToggle.bringToFront();
        if(hint!=null)hint.bringToFront();
        if(layerPanel!=null&&layerPanel.getVisibility()==View.VISIBLE)layerPanel.bringToFront();
    }

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
            canvas.addImageFile(out); canvas.requestFocus(); scheduleAutosave();
        }catch(Exception e){ if(hint!=null)hint.setText("画像の読み込みに失敗: "+e.getMessage()); }
    }

    private void selectTool(NativeCanvasView.Tool tool){fixedNote.setVisibility(View.GONE);canvas.setTool(tool);canvas.requestFocus();updateToolButtons();}

    private void updateToolButtons(){
        NativeCanvasView.Tool tool=canvas.getTool();
        boolean pen=tool==NativeCanvasView.Tool.PEN||tool==NativeCanvasView.Tool.VECTOR_PEN, eraser=tool==NativeCanvasView.Tool.ERASER;
        setSelected(penButton,pen);setSelected(eraserButton,eraser);setSelected(gridButton,canvas.isGridEnabled());
        setSelected(noteButton,fixedNote.getVisibility()==View.VISIBLE);setSelected(sheetButton,sheetView.getVisibility()==View.VISIBLE);
        setSelected(chartButton,chartView.getVisibility()==View.VISIBLE);setSelected(layersButton,layerPanel.getVisibility()==View.VISIBLE);
        if(hint!=null) hint.setText(titleFor(currentNoteId)+"    自動保存    "+canvas.getToolDisplayName()+"    Sペン側面: 消しゴム");
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
        if(ctrl){switch(code){case KeyEvent.KEYCODE_A:canvas.selectAll();return true;case KeyEvent.KEYCODE_D:canvas.clearSelection();return true;case KeyEvent.KEYCODE_C:canvas.copySelection();return true;case KeyEvent.KEYCODE_X:canvas.cutSelection();scheduleAutosave();return true;case KeyEvent.KEYCODE_V:canvas.pasteSelection();scheduleAutosave();return true;case KeyEvent.KEYCODE_Z:if(shift)canvas.redo();else canvas.undo();scheduleAutosave();return true;default:break;}}
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
            case KeyEvent.KEYCODE_DEL:case KeyEvent.KEYCODE_FORWARD_DEL:canvas.deleteSelection();scheduleAutosave();return true;
            default:return super.dispatchKeyEvent(event);
        }
    }

    private void saveStudio(File target){
        try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(target)))){
            out.writeInt(0x53545531);
            out.writeUTF(fixedNote.getText().toString());
            out.writeBoolean(sheetView.getVisibility()==View.VISIBLE);
            out.writeBoolean(chartView.getVisibility()==View.VISIBLE);
            sheetView.writeTo(out);
        }catch(Exception ignored){}
    }
    private void loadStudio(File source){
        if(!source.isFile())return;
        try(DataInputStream in=new DataInputStream(new BufferedInputStream(new FileInputStream(source)))){
            if(in.readInt()!=0x53545531)return;
            fixedNote.setText(in.readUTF());
            sheetView.setVisibility(in.readBoolean()?View.VISIBLE:View.GONE);
            chartView.setVisibility(in.readBoolean()?View.VISIBLE:View.GONE);
            sheetView.readFrom(in);
        }catch(Exception ignored){}
    }

    private int dp(float v){return Math.round(v*getResources().getDisplayMetrics().density);}

    @Override protected void onResume(){
        super.onResume();
        autosaveHandler.removeCallbacks(autosaveTick);
        autosaveHandler.postDelayed(autosaveTick,1800);
    }
    @Override protected void onPause(){
        autosaveHandler.removeCallbacks(autosaveTick);
        autosaveHandler.removeCallbacks(autosaveSoon);
        saveCurrentNote();
        super.onPause();
    }
}
