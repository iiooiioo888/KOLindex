#!/usr/bin/env node
/**
 * 本機開發 BFF：預設不設通行碼，表單任填操作者名稱即可進入。
 * 要測閘門時另開終端，直接帶 KOL_GATE / KOL_OPERATOR 跑 tests/dev-server.mjs。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const server = path.join(root, "tests", "dev-server.mjs");

const env = { ...process.env };
if (env.KOL_FORCE_GATE !== "1") {
  delete env.KOL_GATE;
  delete env.KOL_OPERATOR;
}
if (!env.KOL_DEV_OPERATOR) env.KOL_DEV_OPERATOR = "1";
if (!env.KOL_PROD) env.KOL_PROD = "0";
if (!env.HOST) env.HOST = "127.0.0.1";
env.PORT = env.PORT || "5201";

const child = spawn(process.execPath, [server, root, env.PORT], {
  cwd: root,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
