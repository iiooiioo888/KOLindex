#!/usr/bin/env node
/**
 * NAS 備份：PostgreSQL dump + 關鍵設定檔（不含秘密明文）。
 *
 * 環境（只放 NAS，不進 git）：
 *   KOL_NAS_ROOT          本機資料根（預設 data/nas）
 *   KOL_BACKUP_LOCAL      本機備份目錄（預設 $KOL_NAS_ROOT/backups）
 *   KOL_BACKUP_OFFSITE    異地目錄（選填；設了才複製）
 *   KOL_BACKUP_KEEP       本機／異地各保留份數（預設 7）
 *   KOL_COMPOSE_DIR       compose 目錄（預設 infra/compose）
 *   KOL_COMPOSE_PROJECT   compose 專案名（預設 kolindex）
 *   POSTGRES_USER / POSTGRES_DB  （預設 kolindex）
 *
 * 用法：
 *   node scripts/nas/backup.mjs
 *   node scripts/nas/backup.mjs --dry-run
 *   node scripts/nas/backup.mjs --skip-offsite
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, createWriteStream, existsSync, mkdirSync,
  readdirSync, readFileSync, rmSync, statSync, writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function env(name, fallback) {
  const v = (process.env[name] || '').trim();
  return v || fallback;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z'
  );
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function sha256File(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function listStampDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => /^\d{8}T\d{6}Z$/.test(n))
    .map((n) => ({ name: n, path: join(root, n), mtime: statSync(join(root, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function prune(root, keep) {
  const rows = listStampDirs(root);
  const drop = rows.slice(Math.max(0, keep));
  for (const row of drop) {
    rmSync(row.path, { recursive: true, force: true });
  }
  return { kept: Math.min(rows.length, keep), removed: drop.map((d) => d.name) };
}

function redactEnvText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.trim().startsWith('#')) return line;
      const i = line.indexOf('=');
      if (i < 0) return line;
      const key = line.slice(0, i).trim();
      const sensitive = /(PASSWORD|SECRET|TOKEN|KEY|GATE|COOKIE|AGE|PRIVATE)/i.test(key);
      if (sensitive) return key + '=***REDACTED***';
      return line;
    })
    .join('\n');
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...opts
  });
  return r;
}

async function gzipFile(src, dest) {
  const gzip = createGzip({ level: 9 });
  const input = readFileSync(src);
  /* 小到中型 dump 用 buffer；極大庫可改成串流檔案 */
  const { Readable } = await import('node:stream');
  await pipeline(Readable.from(input), gzip, createWriteStream(dest));
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const skipOffsite = argv.includes('--skip-offsite');

  const nasRoot = resolve(env('KOL_NAS_ROOT', join(ROOT, 'data', 'nas')));
  const localRoot = resolve(env('KOL_BACKUP_LOCAL', join(nasRoot, 'backups')));
  const offsiteRoot = (process.env.KOL_BACKUP_OFFSITE || '').trim();
  const keep = Math.max(1, parseInt(env('KOL_BACKUP_KEEP', '7'), 10) || 7);
  const composeDir = resolve(env('KOL_COMPOSE_DIR', join(ROOT, 'infra', 'compose')));
  const project = env('KOL_COMPOSE_PROJECT', 'kolindex');
  const pgUser = env('POSTGRES_USER', 'kolindex');
  const pgDb = env('POSTGRES_DB', 'kolindex');
  const id = stamp();
  const dest = join(localRoot, 'postgres-config', id);

  const summary = {
    id,
    dry,
    localRoot,
    offsite: offsiteRoot || null,
    keep,
    steps: [],
    ok: true
  };

  function note(step, ok, detail) {
    summary.steps.push({ step, ok, detail });
    if (!ok) summary.ok = false;
    console.log((ok ? '[ok] ' : '[fail] ') + step + (detail ? ' · ' + detail : ''));
  }

  if (dry) {
    note('plan', true, '會寫入 ' + dest + (offsiteRoot && !skipOffsite ? ' 並複製到 ' + offsiteRoot : ''));
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  ensureDir(dest);

  /* 1) PostgreSQL dump（經 compose 服務，不把密碼寫進 argv 日誌） */
  const dumpSql = join(dest, 'kolindex.sql');
  const dumpArgs = [
    'compose', '-p', project, '-f', join(composeDir, 'docker-compose.yml'),
    'exec', '-T', 'postgres',
    'pg_dump', '-U', pgUser, '-d', pgDb, '--no-owner', '--no-acl', '--format=plain'
  ];
  const dump = run('docker', dumpArgs, { cwd: composeDir });
  if (dump.status !== 0) {
    note('pg_dump', false, (dump.stderr || dump.stdout || 'exit ' + dump.status).trim().slice(0, 400));
    writeFileSync(join(dest, 'FAILED.json'), JSON.stringify(summary, null, 2));
    process.exit(1);
  }
  writeFileSync(dumpSql, dump.stdout, 'utf8');
  const gz = dumpSql + '.gz';
  await gzipFile(dumpSql, gz);
  rmSync(dumpSql, { force: true });
  const dumpHash = sha256File(gz);
  writeFileSync(join(dest, 'kolindex.sql.gz.sha256'), dumpHash + '  kolindex.sql.gz\n');
  note('pg_dump', true, 'sha256=' + dumpHash.slice(0, 16) + '…');

  /* 2) 設定檔（compose 定義 + 去敏 .env 鍵清單） */
  const cfgDir = join(dest, 'config');
  ensureDir(cfgDir);
  for (const name of readdirSync(composeDir)) {
    if (!name.startsWith('docker-compose') || !name.endsWith('.yml')) continue;
    copyFileSync(join(composeDir, name), join(cfgDir, name));
  }
  const envPath = join(composeDir, '.env');
  if (existsSync(envPath)) {
    writeFileSync(join(cfgDir, 'compose.env.redacted'), redactEnvText(readFileSync(envPath, 'utf8')));
    note('config.env', true, '已寫 compose.env.redacted（秘密遮蔽）');
  } else {
    note('config.env', true, '無 infra/compose/.env（略過）');
  }
  /* 複製倉庫內非秘密範例 */
  const example = join(ROOT, 'secrets', 'api-tokens.example.yaml');
  if (existsSync(example)) copyFileSync(example, join(cfgDir, 'api-tokens.example.yaml'));

  const meta = {
    id,
    createdAt: new Date().toISOString(),
    hostArch: process.arch,
    platform: process.platform,
    nasRoot,
    dump: { file: 'kolindex.sql.gz', sha256: dumpHash },
    note: '異地路徑由 KOL_BACKUP_OFFSITE 決定；本檔不含明文密碼／Token'
  };
  writeFileSync(join(dest, 'MANIFEST.json'), JSON.stringify(meta, null, 2) + '\n');
  note('manifest', true, dest);

  const prunedLocal = prune(join(localRoot, 'postgres-config'), keep);
  note('prune.local', true, 'kept=' + prunedLocal.kept + ' removed=' + prunedLocal.removed.length);

  /* 3) 異地 */
  if (offsiteRoot && !skipOffsite) {
    const remote = resolve(offsiteRoot, 'postgres-config', id);
    ensureDir(remote);
    for (const name of readdirSync(dest)) {
      const src = join(dest, name);
      const st = statSync(src);
      if (st.isDirectory()) {
        ensureDir(join(remote, name));
        for (const inner of readdirSync(src)) {
          copyFileSync(join(src, inner), join(remote, name, inner));
        }
      } else {
        copyFileSync(src, join(remote, name));
      }
    }
    const prunedOff = prune(resolve(offsiteRoot, 'postgres-config'), keep);
    note('offsite', true, remote + ' · removed=' + prunedOff.removed.length);
  } else {
    note('offsite', true, skipOffsite ? '略過（--skip-offsite）' : '未設 KOL_BACKUP_OFFSITE（只留本機）');
  }

  writeFileSync(join(dest, 'RESULT.json'), JSON.stringify(summary, null, 2) + '\n');
  /* 最新指標（方便監控腳本讀） */
  const latest = join(localRoot, 'postgres-config', 'LATEST');
  try {
    if (existsSync(latest)) rmSync(latest, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
  try {
    writeFileSync(join(localRoot, 'postgres-config', 'LATEST.txt'), id + '\n');
  } catch (_) { /* ignore */ }

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e && e.stack || e));
  process.exit(1);
});
