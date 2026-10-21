import {commitTime} from "./build-revision.mjs";
import { copyFile, cp, mkdir, rm, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const base = process.env.CANVAS_BASE || "/canvas/";
const output = join(root, process.env.CANVAS_OUT || "public/canvas");
const assets = join(output, "assets");
const manifest = JSON.parse(await readFile(join(output, ".vite", "manifest.json"), "utf8"));
const built = new Set(Object.values(manifest).flatMap(entry => [entry.file, ...entry.css || [], ...entry.assets || []])
  .filter(name => name.startsWith("assets/")));
// PDF worker support files are part of the same atomic offline/Android bundle.
const pdfSupport=join(assets,'pdf-support');
await rm(pdfSupport,{recursive:true,force:true});
await mkdir(pdfSupport,{recursive:true});
await copyFile(join(root,'node_modules','pdfjs-dist','LICENSE'),join(pdfSupport,'LICENSE'));
for(const folder of ['cmaps','standard_fonts','wasm']){
  await cp(join(root,'node_modules','pdfjs-dist',folder),join(pdfSupport,folder),{recursive:true});
}
async function assetFiles(directory,prefix='assets'){
  const found=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const relative=prefix+'/'+entry.name;
    if(entry.isDirectory())found.push(...await assetFiles(join(directory,entry.name),relative));
    else found.push(relative);
  }
  return found;
}
for(const name of await assetFiles(pdfSupport,'assets/pdf-support'))built.add(name);
await Promise.all((await assetFiles(assets)).filter(name=>!built.has(name)).map(name=>unlink(join(output,name))));
const files = [...built].sort().map(name => base + name);
await writeFile(join(output, "offline-assets.json"), JSON.stringify(files));
const serviceWorker = await readFile(join(root, "src", "service-worker.js"), "utf8");
const buildId = createHash("sha256").update(JSON.stringify(files)).update(serviceWorker).digest("hex").slice(0, 12);
await writeFile(join(output, "build-version.json"), JSON.stringify({ buildId, commitTime:commitTime(), commit: process.env.VITE_APP_COMMIT || "" }));
await writeFile(join(output, "sw.js"), serviceWorker.replace("__BUILD_ID__", buildId));
await copyFile(join(root, "public", "favicon.svg"), join(output, "favicon.svg"));
const webManifest = JSON.parse(await readFile(join(root, "public", "manifest.webmanifest"), "utf8"));
webManifest.name = "KaeruNote";
webManifest.short_name = "KaeruNote";
webManifest.start_url = base;
webManifest.scope = base;
webManifest.icons = [{ src: base + "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }];
await writeFile(join(output, "manifest.webmanifest"), JSON.stringify(webManifest, null, 2));
