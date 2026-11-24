# ADR-004 業務 API 語言與遷移路徑

- 狀態：已接受為本階段決定
- 日期：2026-11-24
- 既有 ADR-001 到 ADR-003 維持原編號，不改寫

## 決定

`kolindex-api` 的 `node:sqlite` 暫作 intake buffer。新的寫入走這個倉庫的 FastAPI 控制面（`apps/control/app.py`）。表從 buffer 逐步搬進 PostgreSQL。正式環境 `KOL_PROD=1` 時，控制面拒絕只用 SQLite 啟動。

## 為什麼

現在的業務資料在另一個 repo 的 SQLite，這個倉庫的頁面透過代理去讀。一次把全部表搬進 PostgreSQL 會把還沒核對的寫入路徑一起帶走。先把原始抓取、衍生檔、變化候選和人審裁決收成四個追加端點，採集器就不再需要 SQLite 的寫權限。

## 代價

過渡期有兩個存放處。buffer 裡的列不是真相。頁面上舊的 `/api/*` 仍指向原後端，直到呼叫端改打這四個端點。FastAPI 行程要另外啟動，不在網頁容器裡。

## 何時重審

buffer 連續兩週沒有新的寫入，而且四個端點的讀取已由 PostgreSQL 提供。那時拆掉 SQLite buffer，不再保留雙寫。
