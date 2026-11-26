#!/usr/bin/env node
/**
 * 核對 Compose 固定摘要映像是否同時含 amd64 / arm64。
 * 家用 NAS 常見 ARM64；缺架構即阻斷（exit 1）。
 *
 * 用法：
 *   node scripts/nas/verify-multiarch.mjs
 *   node scripts/nas/verify-multiarch.mjs --write-inventory
 *   node scripts/nas/verify-multiarch.mjs --offline   # 只讀 inventory，不打 registry
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const COMPOSE_DIR = join(ROOT, 'infra', 'compose');
const INVENTORY = join(__dirname, 'image-arch-inventory.json');
const REQUIRED = new Set(['amd64', 'arm64']);
const DIGEST_RE = /(?:^|\s)(?:image:\s*)?["']?([a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?)@sha256:([a-f0-9]{64})["']?/gim;

function parseArgs(argv) {
  return {
    write: argv.includes('--write-inventory'),
    offline: argv.includes('--offline'),
    mainOnly: argv.includes('--main-only'),
    help: argv.includes('-h') || argv.includes('--help')
  };
}

function composeFiles(mainOnly) {
  return readdirSync(COMPOSE_DIR)
    .filter((n) => {
      if (!n.startsWith('docker-compose') || !n.endsWith('.yml')) return false;
      if (mainOnly) return n === 'docker-compose.yml';
      return true;
    })
    .map((n) => join(COMPOSE_DIR, n));
}

function collectImages(mainOnly) {
  const map = new Map();
  for (const file of composeFiles(mainOnly)) {
    const text = readFileSync(file, 'utf8');
    let m;
    DIGEST_RE.lastIndex = 0;
    while ((m = DIGEST_RE.exec(text))) {
      const ref = `${m[1]}@sha256:${m[2]}`;
      if (!map.has(ref)) map.set(ref, { ref, digest: m[2], files: [] });
      map.get(ref).files.push(file.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
    }
  }
  return [...map.values()];
}

function hasDocker() {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    windowsHide: true
  });
  return r.status === 0;
}

function inspectArches(ref) {
  const r = spawnSync(
    'docker',
    ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .}}'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || 'inspect failed').trim(), arches: [] };
  }
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch (e) {
    return { ok: false, error: 'json parse: ' + e.message, arches: [] };
  }
  const arches = new Set();
  const manifest = data.manifest || data;
  if (Array.isArray(manifest.manifests)) {
    for (const item of manifest.manifests) {
      const a = item.platform && item.platform.architecture;
      if (a && a !== 'unknown') arches.add(a);
    }
  }
  if (manifest.platform && manifest.platform.architecture) {
    arches.add(manifest.platform.architecture);
  }
  /* 部分輸出把平台列在 .platforms */
  if (Array.isArray(data.platforms)) {
    for (const p of data.platforms) {
      if (typeof p === 'string' && p.includes('/')) arches.add(p.split('/')[1]);
      else if (p && p.architecture) arches.add(p.architecture);
    }
  }
  return { ok: true, error: null, arches: [...arches].sort() };
}

function loadInventory() {
  if (!existsSync(INVENTORY)) return { generatedAt: null, images: {} };
  return JSON.parse(readFileSync(INVENTORY, 'utf8'));
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) {
    console.log(`用法：node scripts/nas/verify-multiarch.mjs [--write-inventory] [--offline] [--main-only]
必要架構：amd64, arm64
來源：infra/compose/docker-compose*.yml 內 @sha256 固定映像
--main-only 只核對第一版 docker-compose.yml（略過 later／oss）`);
    process.exit(0);
  }

  const images = collectImages(opt.mainOnly);
  if (!images.length) {
    console.error('找不到任何 @sha256 映像。');
    process.exit(2);
  }

  const inventory = loadInventory();
  const results = [];
  let failed = 0;

  if (opt.offline) {
    for (const img of images) {
      const row = inventory.images && inventory.images[img.ref];
      const arches = (row && row.arches) || [];
      const missing = [...REQUIRED].filter((a) => !arches.includes(a));
      const ok = missing.length === 0;
      if (!ok) failed += 1;
      results.push({ ref: img.ref, arches, missing, ok, source: 'inventory', files: img.files });
    }
  } else {
    if (!hasDocker()) {
      console.error('本機沒有可用的 docker。改用：node scripts/nas/verify-multiarch.mjs --offline');
      console.error('或先安裝 Docker／在 CI 跑 .github/workflows/multiarch-images.yml');
      process.exit(2);
    }
    for (const img of images) {
      const info = inspectArches(img.ref);
      const arches = info.arches;
      const missing = info.ok ? [...REQUIRED].filter((a) => !arches.includes(a)) : [...REQUIRED];
      const ok = info.ok && missing.length === 0;
      if (!ok) failed += 1;
      results.push({
        ref: img.ref,
        arches,
        missing,
        ok,
        error: info.error,
        source: 'docker',
        files: img.files
      });
    }
  }

  if (opt.write && !opt.offline) {
    const next = {
      generatedAt: new Date().toISOString(),
      required: [...REQUIRED],
      images: {}
    };
    for (const r of results) {
      next.images[r.ref] = {
        arches: r.arches,
        ok: r.ok,
        files: r.files,
        checkedAt: next.generatedAt
      };
    }
    writeFileSync(INVENTORY, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log('已寫入 ' + INVENTORY);
  }

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    required: [...REQUIRED],
    total: results.length,
    failed,
    results
  }, null, 2));

  process.exit(failed ? 1 : 0);
}

main();
