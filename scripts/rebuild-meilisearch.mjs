/* 從 PostgreSQL 的公開欄位重建 Meilisearch。索引是衍生，刪掉可以重做。
 * node scripts/rebuild-meilisearch.mjs --self-test
 * node scripts/rebuild-meilisearch.mjs --input export.json
 */
import http from 'node:http';
import fs from 'node:fs';

const INDEX = 'kolindex_media';

function documentsFrom(rows) {
  return rows.map((row) => ({
    id: String(row.seq),
    checksum: row.checksum,
    source_url: row.source_url,
    captured_at: row.captured_at,
    time_status: row.time_status,
  }));
}

function postJson(url, key, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

async function rebuild(base, key, rows) {
  const root = base.replace(/\/+$/, '');
  await postJson(root + '/indexes', key, { uid: INDEX, primaryKey: 'id' });
  await fetch(root + '/indexes/' + INDEX + '/documents', { method: 'DELETE', headers: { authorization: 'Bearer ' + key } });
  const docs = documentsFrom(rows);
  if (!docs.length) return { ok: true, count: 0 };
  const added = await postJson(root + '/indexes/' + INDEX + '/documents', key, docs);
  return { ok: true, count: docs.length, task: added.taskUid || added.updateId || null };
}

function selfTest() {
  const rows = [{ seq: 1, checksum: 'abc', source_url: 'https://example.test/a', captured_at: '2026-11-24T00:00:00Z', time_status: 'fact' }];
  return new Promise((resolve, reject) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let buf = '';
      req.on('data', (c) => { buf += c; });
      req.on('end', () => {
        seen.push(req.method + ' ' + req.url);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ taskUid: seen.length }));
      });
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        const result = await rebuild('http://127.0.0.1:' + port, 'test-key', rows);
        if (result.count !== 1) throw new Error('count');
        if (!seen.some((line) => line.startsWith('DELETE /indexes/' + INDEX + '/documents'))) throw new Error('no delete');
        if (!seen.some((line) => line.startsWith('POST /indexes/' + INDEX + '/documents'))) throw new Error('no post');
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest().then((result) => {
    console.log(JSON.stringify(result));
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  const inputFlag = args.indexOf('--input');
  const input = inputFlag >= 0 ? args[inputFlag + 1] : '';
  const base = process.env.MEILI_HOST || 'http://127.0.0.1:7700';
  const key = process.env.MEILI_MASTER_KEY || '';
  if (!input || !key) {
    console.error('需要 --input export.json 與 MEILI_MASTER_KEY');
    process.exit(2);
  }
  const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
  rebuild(base, key, rows).then((result) => {
    console.log(JSON.stringify(result));
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
