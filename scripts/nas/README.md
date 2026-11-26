# NAS 部署自動化腳本

| 腳本 | 用途 |
|---|---|
| `verify-multiarch.mjs` | 核對 Compose `@sha256` 映像是否含 amd64＋arm64 |
| `backup.mjs` | PostgreSQL dump＋設定備份；可複製到 `KOL_BACKUP_OFFSITE` |
| `image-arch-inventory.json` | 最近一次架構核對結果（CI／`--write-inventory` 更新） |
| `schedule.example.md` | cron／Windows 排程範例（不含秘密） |

決策見 `docs/adr/ADR-010-nas-deploy-automation.md`。操作步驟見 `docs/runbooks/nas-deploy-and-backup.md`。
