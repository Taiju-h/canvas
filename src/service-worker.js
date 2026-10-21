const CACHE = "uzero-canvas-shell-__BUILD_ID__";
const OFFLINE = "/canvas/index.html";
const ASSETS = "/canvas/offline-assets.json";
self.addEventListener("install",event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE),response=await fetch(ASSETS,{cache:"no-store"});
  if(!response.ok)throw new Error("Offline asset list unavailable");
  const manifest=await response.json();
  // PDF support files are cached when used. A missing optional font must not
  // prevent the editor itself from becoming available offline.
  const core=manifest.filter(path=>!path.includes('/assets/pdf-support/'));
  await cache.addAll([OFFLINE,"/canvas/manifest.webmanifest","/canvas/favicon.svg",...core]);
  await cache.put(ASSETS,new Response(JSON.stringify(manifest),{headers:{"Content-Type":"application/json"}}));
  await self.skipWaiting();
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  const old=(await caches.keys()).filter(key=>key.startsWith("uzero-canvas-shell-")&&key!==CACHE);
  // A tab still running the previous bundle may need one of its lazy chunks.
  await Promise.all(old.slice(0,-1).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
async function matchShell(request){
  const current=await(await caches.open(CACHE)).match(request);if(current)return current;
  for(const key of (await caches.keys()).filter(key=>key.startsWith("uzero-canvas-shell-")&&key!==CACHE).reverse()){
    const hit=await(await caches.open(key)).match(request);if(hit)return hit;
  }
}
self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin)return;
  const editor=["/","/index.html","/index.php","/canvas/","/canvas/index.html","/canvas/index.php"].includes(url.pathname);
  if(request.mode==="navigate"&&editor){
    event.respondWith((async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);
      try{const response=await fetch(request,{signal:controller.signal});if(!response.ok)throw new Error("Editor unavailable");return response;}
      catch{return await matchShell(OFFLINE)||Response.error();}finally{clearTimeout(timer);}
    })());return;
  }
  if(url.pathname.startsWith("/canvas/assets/")||/^\/canvas\/(?:manifest\.webmanifest|favicon\.svg|icon-\d+\.png)$/.test(url.pathname)){
    event.respondWith((async()=>{const cached=await matchShell(request);if(cached)return cached;const response=await fetch(request);if(response.ok)await(await caches.open(CACHE)).put(request,response.clone());return response;})());
  }
  // Authenticated PHP/API responses and user data never enter the shell cache.
});
