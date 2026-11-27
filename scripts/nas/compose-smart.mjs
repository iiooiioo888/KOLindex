#!/usr/bin/env node
/**
 * Compose 智慧啟動（受控，非自治）
 * 1) 解析 profiles
 * 2) 多架構映像核對（可 --skip-arch）
 * 3) docker compose config
 * 4) up -d
 * 5) ps / 健康摘要
 *
 * 用法：
 *   node scripts/nas/compose-smart.mjs
 *   node scripts/nas/compose-smart.mjs --profiles oss
 *   node scripts/nas/compose-smart.mjs --profiles oss,backup
 *   node scripts/nas/compose-smart.mjs --profiles later   # 第一版勿用
 *   node scripts/nas/compose-smart.mjs --dry-run
 *   node scripts/nas/compose-smart.mjs --skip-arch
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const COMPOSE_DIR = join(ROOT, 'infra', 'compose');
const ENV_FILE = join(COMPOSE_DIR, '.env');
const MAIN = join(COMPOSE_DIR, 'docker-compose.yml');

const ALLOWED = new Set(['oss', 'backup', 'later']);
const BLOCKED_DEFAULT = new Set(['later']); /* 智慧啟動預設拒開 later，需 --allow-later */

function parseArgs(argv) {
  const out = {
    profiles: [],
    dryRun: argv.includes('--dry-run'),
    skipArch: argv.includes('--skip-arch'),
    allowLater: argv.includes('--allow-later'),
    down: argv.includes('--down'),
    help: argv.includes('-h') || argv.includes('--help')
  };
  const i = argv.indexOf('--profiles');
  if (i >= 0 && argv[i + 1]) {
    out.profiles = String(argv[i + 1])
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || COMPOSE_DIR,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...(opts.env || {}) }
  });
  return {
    status: r.status == null ? 1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error
  };
}

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`compose-smart — 受控 Compose 啟動
  --profiles oss[,backup][,later]
  --dry-run          只核對與 config，不 up
  --skip-arch        略過多架構核對
  --allow-later      允許 profile later（第一版勿用）
  --down             對應 profiles 執行 down
`);
    process.exit(0);
  }

  if (!existsSync(MAIN)) die('找不到 docker-compose.yml');
  if (!existsSync(ENV_FILE)) {
    console.warn('警告：infra/compose/.env 不存在。請從 .env.example 複製。');
  }

  for (const p of args.profiles) {
    if (!ALLOWED.has(p)) die('未知 profile：' + p + '（允許：oss, backup, later）');
  }
  if (args.profiles.includes('later') && !args.allowLater) {
    die('拒絕自動開啟 profile later（Redis／MinIO）。若確認需要：加 --allow-later');
  }
  if (args.profiles.some((p) => BLOCKED_DEFAULT.has(p)) && !args.allowLater) {
    die('later 被預設阻斷');
  }

  const profileArgs = [];
  for (const p of args.profiles) {
    profileArgs.push('--profile', p);
  }

  const base = ['compose', '--env-file', ENV_FILE, '-f', MAIN, '-p', 'kolindex', ...profileArgs];

  console.log('== profiles ==', args.profiles.length ? args.profiles.join(',') : '(core only)');

  if (!args.skipArch) {
    console.log('== verify-multiarch ==');
    const archArgs = [join(ROOT, 'scripts/nas/verify-multiarch.mjs')];
    if (!args.profiles.length) archArgs.push('--main-only');
    const arch = run(process.execPath, archArgs, { cwd: ROOT });
    process.stdout.write(arch.stdout);
    process.stderr.write(arch.stderr);
    if (arch.status !== 0) die('多架構核對失敗，已阻斷 compose up', arch.status);
  }

  console.log('== compose config ==');
  const cfg = run('docker', [...base, 'config', '-q']);
  if (cfg.status !== 0) {
    process.stderr.write(cfg.stderr || cfg.stdout);
    die('compose config 失敗', cfg.status);
  }
  console.log('config ok');

  if (args.dryRun) {
    console.log('dry-run：到此停止');
    process.exit(0);
  }

  if (args.down) {
    console.log('== compose down ==');
    const down = run('docker', [...base, 'down']);
    process.stdout.write(down.stdout);
    process.stderr.write(down.stderr);
    process.exit(down.status);
  }

  console.log('== compose up -d ==');
  const up = run('docker', [...base, 'up', '-d', '--remove-orphans']);
  process.stdout.write(up.stdout);
  process.stderr.write(up.stderr);
  if (up.status !== 0) die('compose up 失敗', up.status);

  console.log('== compose ps ==');
  const ps = run('docker', [...base, 'ps']);
  process.stdout.write(ps.stdout);
  process.stderr.write(ps.stderr);

  console.log('== tip ==');
  console.log('健康頁：/console/#/health · SSR /ops/health');
  console.log('監測開關在宿主行程設 KOL_DOCKER=1（網頁容器固定為 0）');
}

main();
