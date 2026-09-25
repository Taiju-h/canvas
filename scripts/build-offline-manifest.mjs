import { copyFile, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const output = join(root, "public", "canvas");
const assets = join(output, "assets");
const manifest = JSON.parse(await readFile(join(output, ".vite", "manifest.json"), "utf8"));
const built = new Set(Object.values(manifest).flatMap(entry => [entry.file, ...entry.css || [], ...entry.assets || []])
  .filter(name => name.startsWith("assets/")));
await Promise.all((await readdir(assets)).filter(name => !built.has("assets/" + name))
  .map(name => unlink(join(assets, name))));
const files = [...built].sort().map(name => "/canvas/" + name);
await writeFile(join(output, "offline-assets.json"), JSON.stringify(files));
const serviceWorker = await readFile(join(root, "public", "sw.js"), "utf8");
const buildId = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 12);
await writeFile(join(output, "sw.js"), serviceWorker.replace("__BUILD_ID__", buildId));
await copyFile(join(root, "public", "favicon.svg"), join(output, "favicon.svg"));
await copyFile(join(root, "public", "manifest.webmanifest"), join(output, "manifest.webmanifest"));
