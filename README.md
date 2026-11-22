# 靈境 · Linkin — 執行時原型

「自動認領 × LLM 空檔排程」的介面原型：12 個分頁，其中任務收集、人物檔案、
審核台、基礎設施（連接器／排程工作）、素材庫與右欄監控面板接本機 `kolindex-api`
（SQLite）的真實資料，其餘是示範資料。

## 本機

```
node tests/dev-server.mjs . 5200     # 零依賴靜態站，自動 live reload
```

開 http://127.0.0.1:5200/ 。後端 `kolindex-api` 在 5210（見該專案的 README），
素材庫的圖片與影片由 5400 的靜態站供檔；後端沒開時頁面退回示範資料，不會壞。

## 檢查

```
node tests/test-wireframe.js   # 線框圖渲染器（純函式）
node tests/test-page.mjs       # 站台輸出、資產 MIME、id 對齊、分頁註冊
node tests/test-ds.mjs         # 設計系統四層、權杖、零轉場
node tests/test-balance.mjs    # HTML 標籤開閉配對
```

四支都只打本機 5200，不需要後端。`push` / `PR` 時 GitHub Actions 會跑同一組
（`.github/workflows/pages.yml` 的 `check` job）。

## GitHub Pages

`main` 通過檢查後會把 `index2.html`、`css/`、`js/`、`fonts/` 發佈到 Pages。
需要在 repo 的 **Settings → Pages → Source** 選一次 **GitHub Actions**
（第一次由 workflow 代開會因為權限不足失敗，見該步驟的 `continue-on-error`）。
Pages 是純靜態，沒有 `/api`，接後端的那幾個分頁會顯示示範資料。
