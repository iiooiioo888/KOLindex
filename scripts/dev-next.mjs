/**
 * 固定起 BFF 5201 + 提示 Next 5200。不跳埠：5201 被佔就退出。
 * 用法：node scripts/dev-next.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = process.env.KOL_GATE || "devpass";
const role = process.env.KOL_ROLE || "operator";

function canListen(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

const free = await canListen(5201);
if (!free) {
  console.error("5201 已被佔用。先關掉舊的 BFF，再跑這個腳本。");
  process.exit(1);
}

const bff = spawn(
  process.execPath,
  [path.join(root, "tests", "dev-server.mjs"), root, "5201"],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: "5201",
      HOST: "127.0.0.1",
      KOL_GATE: gate,
      KOL_ROLE: role,
      KOL_PROD: "0",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

console.log("");
console.log("BFF 已起在 http://127.0.0.1:5201");
console.log("通行碼 = " + gate + " · 角色 = " + role);
console.log("另開終端：cd apps/web && npm run dev");
console.log("然後打開 http://127.0.0.1:5200/console/index.html");
console.log("");

bff.on("exit", (code) => process.exit(code || 0));
process.on("SIGINT", () => bff.kill());
process.on("SIGTERM", () => bff.kill());
