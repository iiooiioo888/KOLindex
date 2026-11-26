/**
 * 把倉庫根目錄的現用畫面同步進 Next public/console。
 * 不改業務邏輯；只複製，好讓 /console/ 對照舊站。
 */
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..", "..");
const dest = join(webRoot, "public", "console");

const dirs = ["css", "js", "fonts"];
for (const name of dirs) {
  const from = join(repoRoot, name);
  if (!existsSync(from)) {
    console.error("缺少目錄：" + from);
    process.exit(1);
  }
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const name of dirs) {
  cpSync(join(repoRoot, name), join(dest, name), { recursive: true });
}

const htmlPath = join(repoRoot, "index2.html");
if (!existsSync(htmlPath)) {
  console.error("缺少 index2.html");
  process.exit(1);
}
let html = readFileSync(htmlPath, "utf8");
if (!html.includes('data-kol-host="next"')) {
  html = html.replace("<html", '<html data-kol-host="next"');
}
writeFileSync(join(dest, "index.html"), html);
writeFileSync(
  join(dest, "HOST.txt"),
  "synced-from-repo-root\nsource=index2.html+css+js+fonts\n",
);
console.log("synced console → " + dest);
