# NAS 排程範例（不要把秘密寫進倉庫）

本機保留 **7** 份；異地目錄用環境變數 `KOL_BACKUP_OFFSITE`（另一顆碟、另一台機、或雲端同步資料夾）。

## 環境檔（只在 NAS）

```bash
# /volume1/kolindex/backup.env   ← 路徑自訂，gitignore
export KOL_NAS_ROOT=/volume1/kolindex/data
export KOL_BACKUP_LOCAL=/volume1/kolindex/data/backups
export KOL_BACKUP_OFFSITE=/volume2/kolindex-offsite/backups
export KOL_BACKUP_KEEP=7
export KOL_COMPOSE_DIR=/volume1/kolindex/repo/infra/compose
export KOL_COMPOSE_PROJECT=kolindex
```

## Linux／Synology（ash／bash）每日 03:15

```cron
15 3 * * * . /volume1/kolindex/backup.env && cd /volume1/kolindex/repo && /usr/local/bin/node scripts/nas/backup.mjs >> /volume1/kolindex/data/backups/backup.log 2>&1
```

每週一 04:00 重跑多架構核對（有 Docker 時）：

```cron
0 4 * * 1 . /volume1/kolindex/backup.env && cd /volume1/kolindex/repo && /usr/local/bin/node scripts/nas/verify-multiarch.mjs --write-inventory >> /volume1/kolindex/data/backups/arch.log 2>&1
```

## Windows 工作排程器

1. 程式：`node.exe`
2. 引數：`E:\Jerry_python\KOLindex\scripts\nas\backup.mjs`
3. 起始於：`E:\Jerry_python\KOLindex`
4. 先載入使用者環境或用「起始指令碼」設 `KOL_BACKUP_OFFSITE`

PowerShell 包裝例：

```powershell
$env:KOL_NAS_ROOT = 'D:\kolindex\data'
$env:KOL_BACKUP_OFFSITE = 'E:\offsite\kolindex-backups'
$env:KOL_BACKUP_KEEP = '7'
Set-Location 'E:\Jerry_python\KOLindex'
node .\scripts\nas\backup.mjs
```

## 還原演練（手動，每季一次）

見 `docs/runbooks/nas-deploy-and-backup.md`。演練前不得宣稱「備份已驗證」。
