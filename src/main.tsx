import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import HybridCanvasEditor from "@/components/hybrid-canvas-editor";
import "./styles.css";

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

async function readSession(): Promise<Session> {
  const response = await fetch(API + encodeURIComponent("/api/session"), {
    credentials: "same-origin", cache: "no-store",
  });
  if (!response.ok) throw new Error("利用者情報を確認できません");
  return response.json() as Promise<Session>;
}

function VisitorGate({ session, onReady }: { session: Session; onReady: (next: Session) => void }) {
  const [nickname, setNickname] = useState(stored("canvasVisitorNickname"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="visitor-gate" aria-labelledby="visitor-title">
    <section className="visitor-card">
      <div className="visitor-mark">C</div>
      <h1 id="visitor-title">キャンバスを使う方</h1>
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
          onReady(result);
        } catch (err) { setError(err instanceof Error ? err.message : "利用者情報を保存できません"); }
        finally { setBusy(false); }
      }}>
        <label htmlFor="visitor-nickname">ニックネーム</label>
        <input id="visitor-nickname" value={nickname} onChange={event => setNickname(event.target.value)} maxLength={40} autoFocus required />
        <p className="visitor-note">利用状況の確認のため、ニックネーム・IPアドレス・利用日時を記録します。</p>
        {error && <p className="visitor-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "確認中…" : "キャンバスを開始"}</button>
      </form>
    </section>
  </main>;
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
  if (!session.authenticated) return <VisitorGate session={session} onReady={setSession} />;
  return <HybridCanvasEditor accountId={session.accountId} />;
}

createRoot(document.getElementById("root")!).render(<App />);
