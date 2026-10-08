// Met à jour web/ depuis les sources de l'app web e-Wari (dossier « app » du projet principal).
// Usage : bun scripts/import-web.ts <chemin du dossier app>   (ex. bun scripts/import-web.ts ../sources/app)
// Puis : npm run sync, et relancer les compilations GitHub (Android, iOS).
import path from "node:path";
const src = path.resolve(process.argv[2] || "../app");
const dst = path.resolve(import.meta.dir, "..", "web");
const page = (await import(path.join(src, "app_server.tsx"))).default;
const html = await (await page.fetch(new Request("http://local/app"))).text();
if (!html.includes('<template id="tpl">')) throw new Error("page /app inattendue");
await Bun.write(path.join(dst, "page.html"), html);
for (const f of ["logic.js", "runtime.js"]) await Bun.write(path.join(dst, f), Bun.file(path.join(src, f)));
const lg = await Bun.file(path.join(dst, "logic.js")).text();
if (!lg.includes("window.EWARI_NATIVE")) throw new Error("logic.js ne contient pas les points d'accroche natifs (EWARI_NATIVE)");
console.log("web/ mis à jour depuis", src);
