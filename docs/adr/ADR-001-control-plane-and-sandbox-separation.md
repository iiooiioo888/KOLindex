# ADR-001 控制面與 Sandbox 分離

- 狀態：已接受為 M0 架構決定
- 日期：2026-11-19
- 規範：KOL-SPEC-001 v4.1 第 6、12 節

## 背景

第三方 Connector、Chromium、下載器與 OCR 程式會執行不受信任的程式碼，也會接觸外部內容。若與 API、資料庫或秘密庫放在同一執行邊界，Sandbox 逃逸或惡意輸出就能直接讀寫核心資料。

## 決定

1. 主棧只運行控制面：Web、FastAPI、Celery、PostgreSQL、Redis、MinIO、Meilisearch、政策與審計。
2. Connector、瀏覽器、下載器與 OCR 執行檔只運行在獨立 VM 的 Sandbox。
3. Sandbox 不可直連 PostgreSQL、Redis、MinIO、Meilisearch、Vault。
4. 唯一回寫路徑是 mTLS Intake API。
5. 不掛載 `/var/run/docker.sock`，不使用 privileged、host network、host PID。
6. 容器為 non-root、read-only rootfs、`cap_drop: ALL`、`no-new-privileges`。
7. 每任務獨立 `/work`，完成後掃描、匯出允許的資料、再銷毀 Volume、Cache 與 Browser Profile。
8. M0.5 只使用模式 A。正式 Cookie 只留在 Trusted Credential Adapter，Sandbox 看不到 Cookie。模式 B 最早到 M4，而且要同時滿足：官方接口與模式 A 都無法完成必要功能、平台條款允許、低權限專用帳號、資料保護影響評估，以及每次 L3。抖音不得把模式 B 當預設。

## 後果

- M0.5 必須先證明隔離、mTLS 與 Egress，才能做 Connector 實跑。
- 主棧映像與 Sandbox 映像分開建置、分開掃描、分開簽名。
- 開發機上的 Docker Compose 不得把 Sandbox 接到主棧資料庫網路。

## 已決定的 M0.5 暫定環境

- 一台獨立新加坡 VM：4 vCPU、8 GB RAM、80 GB SSD、無 GPU。
- Ubuntu LTS、rootless Podman、獨立安全群組。
- 不開放主棧入站。只允許 mTLS Intake 與已批准的 Egress。
- M0.5 先驗證 rootless Podman、seccomp、AppArmor、只讀根檔案系統與 Egress Gateway，不上 Kata。
- gVisor 只作 M0.5 兼容性測試。Chromium 與 Connector 契約都通過後，才可在 M3 把它定為預設 Runtime。Kata 不納入第一版硬依賴。
- 這台 VM 尚未建立。M0.5 可以做設計與本機 POC，不能宣稱隔離驗收完成。雲端部署另要 L3 批准令牌。本 ADR 不簽發該令牌。
