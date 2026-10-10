import { copyFile, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const base = process.env.CANVAS_BASE || "/canvas/";
const output = join(root, process.env.CANVAS_OUT || "public/canvas");
const assets = join(output, "assets");
const manifest = JSON.parse(await readFile(join(output, ".vite", "manifest.json"), "utf8"));
const built = new Set(Object.values(manifest).flatMap(entry => [entry.file, ...entry.css || [], ...entry.assets || []])
  .filter(name => name.startsWith("assets/")));
await Promise.all((await readdir(assets)).filter(name => !built.has("assets/" + name))
  .map(name => unlink(join(assets, name))));
const files = [...built].sort().map(name => base + name);
await writeFile(join(output, "offline-assets.json"), JSON.stringify(files));
const serviceWorker = await readFile(join(root, "public", "sw.js"), "utf8");
const buildId = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 12);
await writeFile(join(output, "build-version.json"), JSON.stringify({ buildId, commit: process.env.VITE_APP_COMMIT || "" }));
await writeFile(join(output, "sw.js"), serviceWorker.replace("__BUILD_ID__", buildId));
await copyFile(join(root, "public", "favicon.svg"), join(output, "favicon.svg"));
const webManifest = JSON.parse(await readFile(join(root, "public", "manifest.webmanifest"), "utf8"));
webManifest.name = "KaeruNote";
webManifest.short_name = "KaeruNote";
webManifest.start_url = base;
webManifest.scope = base;
webManifest.icons = [{ src: base + "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }];
await writeFile(join(output, "manifest.webmanifest"), JSON.stringify(webManifest, null, 2));
