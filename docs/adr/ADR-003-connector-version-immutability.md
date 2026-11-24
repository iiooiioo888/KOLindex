# ADR-003 ConnectorVersion 不可變

- 狀態：已接受為 M0 架構決定
- 日期：2026-11-19
- 規範：KOL-SPEC-001 v4.1 第 7.3、14 節

## 背景

採集程式的映像、依賴、出口網域與輸出 Schema 會改變資料意義與風險。若允許修改已 approved 的版本，先前的掃描、測試與批准就不再對應當前執行內容。

## 決定

1. ConnectorVersion 建立後不可修改。
2. 下列任一變化都要新建版本，並從 `candidate` 重新開始：image digest、git commit、Dockerfile、依賴鎖檔、Egress 清單、輸入或輸出 Schema、權限、Volume。
3. 部署引用寫成 `registry/repository@sha256:<完整摘要>`。
4. `latest`、無授權、Digest 不符、需要 privileged 或 Docker Socket，直接阻斷。
5. Critical 漏洞阻斷。High 預設阻斷；例外要有 Security Owner、可達性分析、緩解與最長 14 天到期，且該例外流程本身是 L3。
6. 未簽名的第三方映像不直接部署。須從官方固定 commit 內部重建、產生 SBOM、掃描、推到內部 Registry，並用 Cosign 簽名。
7. 每個版本保存：官方倉庫、Dockerfile 路徑、commit、registry、image、digest、官方關係證據、SPDX、SBOM、Trivy 或 Grype 報告、Cosign 結果、OpenSSF Scorecard、最後驗證時間。

## 後果

- Registry 里的 approved 記錄是歷史，不是可編輯設定。
- 測試證據跟版本 ID 綁定，不能挪到下一版。
- M2 之前不把任何候選專案標成 approved。M0 也不建立 Registry 資料。

## 已決定的倉庫與簽名

- 部署地區內的私有 Harbor，暫定地址 `registry.kol-index.internal`。這是內部 DNS，不對公網開放。
- CI 使用 OIDC Keyless Cosign，並保存 Rekor 或同等證明。
- 正式 approved 映像再由公司 KMS 或 Vault Transit 的簽名金鑰簽第二次。
- 開發者工作站不得持有正式私鑰。
- M0.5 若還沒有 Harbor，本機臨時 Registry 只能做流程 POC，該映像不得晉升為 approved。

## 仍待確認

五個初始候選的官方 commit 與 SPDX 尚未核對。未核對前不得填入具體 commit，也不得標成 approved。
