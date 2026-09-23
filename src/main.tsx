import React from "react";
import { createRoot } from "react-dom/client";
import CanvasEditor from "@/components/canvas-editor";
import "./styles.css";

type Session = { authenticated: boolean; accountId?: string; csrfToken?: string };

async function start() {
  let session: Session = { authenticated: false };
  if (navigator.onLine) {
    try {
      const response = await fetch("/canvas/api.php?path=%2Fapi%2Fsession", {
        cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(1300),
      });
      if (response.ok) session = await response.json() as Session;
    } catch { /* Local documents remain available without the server. */ }
  }
  window.CanvasCsrf = session.csrfToken || "";
  createRoot(document.getElementById("root")!).render(
    <CanvasEditor signedIn={session.authenticated} accountId={session.accountId}
      signInPath="/canvas/login.php?return_to=%2Fcanvas%2F" />,
  );
}
void start();
