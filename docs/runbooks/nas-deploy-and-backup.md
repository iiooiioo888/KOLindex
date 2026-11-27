# Runbook：NAS 部署與備份異地

對應 ADR-010。數字與架構結論以腳本實際輸出為準，不得手填「已支援」。

## 0. 前置

- [ ] NAS 上已安裝 Docker／Compose，且**不要**把 Docker socket 掛進網頁容器
- [ ] `infra/compose/.env` 只在 NAS（含 `KOL_GATE`、`POSTGRES_PASSWORD`、`MEILI_MASTER_KEY`）
- [ ] `KOL_NAS_ROOT` 指向資料卷；媒體與 postgres 資料目錄可寫
- [ ] 已設定 `KOL_BACKUP_OFFSITE` 到**另一顆碟或另一台主機**的路徑

## 1. 部署前：多架構

```bash
cd <repo>
# 第一版上線閘門（只核對主 Compose）
node scripts/nas/verify-multiarch.mjs --main-only --write-inventory
# 全量（含 oss／later）交給 CI 或週期排程
node scripts/nas/verify-multiarch.mjs --write-inventory
```

退出碼非 0 → **禁止**把對應 profile 的服務 `compose up` 到該 NAS。缺 `arm64` 的映像要換有雙架構的固定摘要，並更新 compose。

無 Docker 的開發機可先：

```bash
node scripts/nas/verify-multiarch.mjs --offline
```

`--offline` 只讀 `scripts/nas/image-arch-inventory.json`，不能代替上線前實測。

## 2. 拉起第一版服務

```bash
# 智慧啟動（建議）
node scripts/nas/compose-smart.mjs
# 需要開源工具時：
# node scripts/nas/compose-smart.mjs --profiles oss

cd infra/compose
docker compose -p kolindex up -d
docker compose -p kolindex ps
```

控制面另開行程並設 `KOL_DATABASE_URL=postgres…`、`KOL_PROD=1`（見 README）。

## 3. 備份（每日）

```bash
export KOL_NAS_ROOT=...
export KOL_BACKUP_OFFSITE=...   # 必填才算異地
export KOL_BACKUP_KEEP=7
node scripts/nas/backup.mjs
```

成功產物：

```text
$KOL_BACKUP_LOCAL/postgres-config/<UTC戳>/
  kolindex.sql.gz
  kolindex.sql.gz.sha256
  MANIFEST.json
  RESULT.json
  config/docker-compose*.yml
  config/compose.env.redacted
```

排程範例：`scripts/nas/schedule.example.md`。

同一方法失敗兩次 → 停止自動重試，轉人工（查 postgres 健康、磁碟空間、異地路徑權限）。

## 4. 還原演練（每季，標註日期與操作者）

1. 在**非生產**目錄起一組暫時 postgres。
2. `gunzip -c kolindex.sql.gz | docker compose exec -T postgres psql -U kolindex -d kolindex`
3. 核對 `SELECT count(*)` 與演練前記錄的關鍵表筆數（以當次測量為準）。
4. 核對 `sha256sum -c kolindex.sql.gz.sha256`。
5. 記錄：日期、操作者、來源備份 id、結果通過／失敗。**失敗不得改口稱為通過。**

## 5. 禁止事項

- 使用 `latest` 映像
- 把明文 `.env` 複進 git 或聊天
- 宣稱「RAID＝已備份」
- 在未設 `KOL_BACKUP_OFFSITE` 時把本機 7 份寫成「異地已完成」
