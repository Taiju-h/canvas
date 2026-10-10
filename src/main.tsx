import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import NotesWorkspace from "@/components/notes-workspace";
import "./styles.css";
import "./visitor.css";

type Session = {
  authenticated: boolean;
  memberAuthenticated?: boolean;
  accountId?: string;
  nickname?: string | null;
  csrfToken?: string;
};

const API = "/canvas/api.php?path=";
function stored(key: string) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function store(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} }
function cachedSession(): Session | null { try { const raw=localStorage.getItem("canvasSessionCache"); return raw?JSON.parse(raw) as Session:null; } catch { return null; } }
function cacheSession(value: Session) { try { localStorage.setItem("canvasSessionCache", JSON.stringify(value)); } catch {} }

async function readSession(): Promise<Session> {
  const cached = cachedSession();
  const appBridge = (window as Window & {CanvasApp?:unknown}).CanvasApp;
  if (appBridge && cached?.authenticated && cached.accountId) {
    void fetch(API + encodeURIComponent("/api/session"), {
      credentials: "same-origin", cache: "no-store",
    }).then(async response => {
      if (response.ok) cacheSession(await response.json() as Session);
    }).catch(()=>{});
    return cached;
  }
  try {
    const response = await fetch(API + encodeURIComponent("/api/session"), {
      credentials: "same-origin", cache: "no-store",
    });
    if (!response.ok) throw new Error("利用者情報を確認できません");
    const result = await response.json() as Session;
    cacheSession(result);
    return result;
  } catch (error) {
    if (cached?.authenticated && cached.accountId) return cached;
    throw error;
  }
}

function VisitorGate({ session, onReady }: { session: Session; onReady: (next: Session) => void }) {
  const [nickname, setNickname] = useState(stored("canvasVisitorNickname"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="visitor-gate" aria-labelledby="visitor-title">
    <section className="visitor-card">
      <div className="visitor-mark">C</div>
      <h1 id="visitor-title">KaeruNoteを使う方</h1>
      <p>会員登録は不要です。ニックネームを入力して開始してください。</p>
      <form onSubmit={async event => {
        event.preventDefault();
        const name = nickname.trim();
        if (!name || name.length > 40) { setError("ニックネームは1～40文字で入力してください"); return; }
        setBusy(true); setError("");
        try {
          const response = await fetch(API + encodeURIComponent("/api/visitor"), {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken || "" },
            body: JSON.stringify({ nickname: name, visitorToken: stored("canvasVisitorToken") }),
          });
          const result = await response.json().catch(() => ({})) as Session & { visitorToken?: string; error?: string };
          if (!response.ok) throw new Error(result.error || "利用者情報を保存できません");
          if (result.visitorToken) store("canvasVisitorToken", result.visitorToken);
          store("canvasVisitorNickname", name);
          window.CanvasCsrf = result.csrfToken || "";
          cacheSession(result);
          onReady(result);
        } catch (err) { setError(err instanceof Error ? err.message : "利用者情報を保存できません"); }
        finally { setBusy(false); }
      }}>
        <label htmlFor="visitor-nickname">ニックネーム</label>
        <input id="visitor-nickname" value={nickname} onChange={event => setNickname(event.target.value)} maxLength={40} autoFocus required />
        <p className="visitor-note">利用状況の確認のため、ニックネーム・IPアドレス・利用日時を記録します。</p>
        {error && <p className="visitor-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "確認中…" : "KaeruNoteを開始"}</button>
      </form>
    </section>
  </main>;
}


function UpdateBadge() {
  const [available,setAvailable]=useState(false);
  const [updating,setUpdating]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    let live=true;
    const check=async()=>{
      try{
        // The currently running bundle's revision is injected during the server build.
        // Fetching build-version.json twice compared the same remote value and never detected updates.
        const runningCommit=import.meta.env.VITE_APP_COMMIT as string | undefined;
        const remote=await fetch("/canvas/build-version.json?check="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject());
        if(live)setAvailable(!!runningCommit&&!!remote?.commit&&runningCommit!==remote.commit);
      }catch{}
    };
    const timer=window.setTimeout(()=>void check(),800);
    const interval=window.setInterval(()=>void check(),5*60*1000);
    const failed=(event:Event)=>{const detail=(event as CustomEvent<string>).detail||"更新できませんでした";setUpdating(false);setMessage(detail);};
    addEventListener("canvas-update-failed",failed);
    return()=>{live=false;clearTimeout(timer);clearInterval(interval);removeEventListener("canvas-update-failed",failed);};
  },[]);
  if(!available&&!message)return null;
  return <div className="canvas-update-status">
    {available&&<button title="新しいKaeruNoteがあります" disabled={updating} onClick={()=>{
      setUpdating(true);setMessage("");
      const bridge=(window as Window & {CanvasApp?:{applyWebUpdate?:()=>void}}).CanvasApp;
      if(bridge?.applyWebUpdate) bridge.applyWebUpdate();
      else { location.href="/canvas/?remoteui=1&update="+Date.now(); }
    }}><b>!</b><span>{updating?"更新中…":"更新あり"}</span></button>}
    {message&&<button className="error" onClick={()=>setMessage("")}>{message}</button>}
  </div>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [fatal, setFatal] = useState("");
  useEffect(() => {
    void readSession().then(result => {
      window.CanvasCsrf = result.csrfToken || "";
      setSession(result);
    }).catch(error => setFatal(error instanceof Error ? error.message : "保存用DBに接続できません"));
  }, []);
  if (fatal) return <main className="visitor-gate"><section className="visitor-card"><h1>接続できません</h1><p>{fatal}</p></section></main>;
  if (!session) return <main className="hybrid-loading"><div className="hybrid-spinner" />起動しています…</main>;
  if (!session.authenticated) return <><VisitorGate session={session} onReady={setSession} /><UpdateBadge /></>;
  return <><NotesWorkspace accountId={session.accountId || ""} /><UpdateBadge /></>;
}

createRoot(document.getElementById("root")!).render(<App />);
