import UpdateBadge from "@/components/web-update-badge";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import NotesWorkspace from "@/components/notes-workspace";
import type { SharedAccess } from "@/lib/use-notes";
import "./styles.css";
import "./visitor.css";
import {readSession,cacheSession,cachedSession,localSession,type Session} from "@/lib/offline-session";
import {setLocalMode} from "@/lib/network";
import {ensureOfflineShell} from "@/lib/offline-shell";
import {prepareWebUpdate} from "@/lib/web-update";

const API = "/canvas/api.php?path=";
function stored(key: string) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function store(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} }
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
      <button type="button" className="kn-local-open" onClick={()=>onReady(localSession())}>{cachedSession()?.authenticated?"端末に保存したノートを開く":"この端末だけで使う"}</button>
    </section>
  </main>;
}


function sharedLink():SharedAccess|undefined{
  const token=new URLSearchParams(location.hash.replace(/^#/, '')).get('share')||'';
  const id=new URLSearchParams(location.search).get('d')||'';
  if(/^[a-f0-9]{32}$/i.test(id)&&/^[a-f0-9]{64}$/i.test(token))return{id:id.toLowerCase(),token:token.toLowerCase()};
  return undefined;
}
function App() {
  const shared=sharedLink();
  const [session,setSession]=useState<Session|null>(null),[fatal,setFatal]=useState(''),[connecting,setConnecting]=useState(false);
  const accept=(next:Session)=>{setLocalMode(!!next.localOnly);window.CanvasCsrf=next.csrfToken||'';setSession(next);setFatal('');};
  const reconnect=async()=>{if(connecting)return;setConnecting(true);try{const next=await readSession(true);await prepareWebUpdate();accept(next);}catch(error){setFatal(error instanceof Error?error.message:'接続できません。端末内の編集は続けられます');}finally{setConnecting(false);}};
  useEffect(()=>{void readSession().then(accept).catch(error=>setFatal(error instanceof Error?error.message:'接続できません'));},[]);
  useEffect(()=>{const online=()=>{if(session?.localOnly&&!session.deviceOnly)void reconnect();};addEventListener('online',online);return()=>removeEventListener('online',online);},[session,connecting]);
  if(!session&&fatal)return <main className="visitor-gate"><section className="visitor-card"><h1>端末でノートを使えます</h1><p>サーバーに接続できません。保存済みのノートを開くか、この端末で新しく書き始められます。</p><p role="status">{fatal}</p><button onClick={()=>accept(localSession())}>{cachedSession()?.authenticated?'端末に保存したノートを開く':'この端末だけで使う'}</button><button onClick={()=>void reconnect()} disabled={connecting}>接続を再確認</button></section></main>;
  if(!session)return <main className="hybrid-loading"><div className="hybrid-spinner"/>起動しています…</main>;
  if(shared)return <NotesWorkspace key={'shared:'+shared.id} accountId={'shared:'+shared.id} sharedAccess={shared}/>;
  if(!session.authenticated)return <><VisitorGate session={session} onReady={accept}/><UpdateBadge floating/></>;
  const workspace=<NotesWorkspace key={session.accountId+':'+!!session.localOnly} accountId={session.accountId||''}/>;
  return session.localOnly?<div className="kn-local-shell"><div className="kn-local-status" role="status"><span>{session.deviceOnly?'この端末に保存しています':'端末のノートを編集中・接続後に同期'}{fatal?'：'+fatal:''}</span><button onClick={()=>void reconnect()} disabled={connecting}>{connecting?'接続確認中…':'オンライン接続'}</button></div>{workspace}</div>:workspace;
}
void ensureOfflineShell().catch(error=>console.warn('KaeruNote offline cache registration failed',error));
createRoot(document.getElementById("root")!).render(<App />);
