# Changelog

## [v0.1.0] — 2026-11-25

Prototype. Not production-ready.

### 這版有什麼

- 靜態監控台 `index2.html` + 本機 `tests/dev-server.mjs`
- 三種角色（viewer / reviewer / operator）與前端 caps
- Compose：PostgreSQL（pgvector）、Meilisearch、開源候選容器
- 控制面四個追加寫入端點（`apps/control`）
- 可掛在 `kolindex-api` 前面的認證閘（`packages/api-auth`、`apps/api-gate`）

### 已知缺口

- `kolindex-api` 不在這個倉庫；直連 `5210` 的認證要靠 api-gate 或把 `authGuard.js` 掛進那個 repo
- 人物檔案仍是抖音作者清單，不是跨平台人物主檔
- 感測上下文、產出庫、統一管線等分頁仍是示範資料
- 正式環境必須設 `KOL_GATE`；公開站若看到 `gate:false` 就是還沒套這版

細節見 `ROADMAP.md`、`PROJECT.md`。
