/** 元件健康必須含 Docker 容器目錄與內容說明。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 5397;
const child = spawn(process.execPath, ['tests/dev-server.mjs', '.', String(port)], {
  cwd: root,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    KOL_PROD: '0',
    KOL_DOCKER: '0',
    KOL_DEV_OPERATOR: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function waitReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('boot timeout')), 8000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes(String(port))) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error('exit ' + code)));
  });
}

try {
  await waitReady();
  const res = await fetch(`http://127.0.0.1:${port}/__health/components`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.items));
  const probes = body.items.filter((x) => x.kind === 'probe' || x.id === 'nas');
  const dockers = body.items.filter((x) => x.kind === 'docker');
  assert.ok(probes.length >= 4, '應有探測項');
  assert.equal(dockers.length, 7, '應有 7 個 Compose 服務');
  for (const row of dockers) {
    assert.ok(row.service, row.id + ' 缺 service');
    assert.ok(row.content, row.service + ' 缺內容說明');
    assert.equal(row.state, 'unset');
  }
  assert.equal(body.docker.enabled, false);
  assert.equal(body.docker.total, 7);
  console.log('ok · components include docker catalog + content');
} finally {
  child.kill();
}
