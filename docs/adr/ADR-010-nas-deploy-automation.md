# ADR-010 NAS 部署自動化（多架構驗證＋備份異地）

- 狀態：已接受
- 日期：2026-11-26
- 相關：ADR-006、ADR-009、PROJECT.md §7

## 決定

1. **多架構是部署前阻斷項。** Compose 內所有 `@sha256` 映像必須同時具備 `amd64` 與 `arm64`（家用 NAS 常見 ARM）。驗證入口：`node scripts/nas/verify-multiarch.mjs`；CI：`.github/workflows/multiarch-images.yml`。
2. **備份自動化與 Compose 同級。** 每日（或 NAS 排程）執行 `node scripts/nas/backup.mjs`：PostgreSQL `pg_dump`（經 `docker compose exec`）＋ compose 定義＋去敏 `.env`。本機預設保留 **7** 份。
3. **異地不是選配口號。** 設 `KOL_BACKUP_OFFSITE` 才算異地；未設時腳本只留本機並在結果標明。磁碟陣列／同一 NAS 另一資料夾**不算**異地。
4. **秘密不進備份產物明文、不進 git。** `.env` 只產出 `compose.env.redacted`。密碼、Token、Cookie、私鑰禁止寫入日誌或 inventory。
5. **不引入 Terraform／Ansible／多雲 Broker。** 第一版用 Compose＋Node 腳本＋系統 cron／工作排程器即可。
6. **還原演練前不得宣稱備份已驗證。** Runbook：`docs/runbooks/nas-deploy-and-backup.md`。

## 為什麼

PROJECT／README 已列「ARM 架構核對」與「異地備份待做」。ROADMAP P4-26 寫明目前只有本機 7 份。沒有自動化時，NAS 換機或陣列故障會丟失 PostgreSQL 真相與設定基線。

## 代價

- CI 需能拉 registry（rate limit／網路失敗會讓 workflow 紅燈，屬預期阻斷）。
- 異地目錄與憑證由操作者在 NAS 環境檔維護，倉庫只給範例。
- `pg_dump` 依賴 postgres 容器健康；容器沒起時備份失敗並寫 `FAILED.json`，不重試超過兩次（由排程／人工決定，腳本本身單次執行）。

## 何時重審

- 正式切換 MinIO／物件儲存備份媒體位元時。
- 引入 Vault 或 SOPS 密封備份時。
- 多架構驗證改用 cosign／SBOM 閘門時。
