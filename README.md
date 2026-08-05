# 鴨鎮撤離行動－離線建置專案

這個資料夾是外部開發環境。無塵室只接收 `release` 內已完成的成品，不接收 `node_modules`，也不需要安裝 VS Code、Node.js 或 pnpm。

## 資料夾

```text
src/game/index.html       遊戲單檔原始碼
electron/main.cjs         安全、離線的 Electron 桌面啟動殼
scripts/                  離線檢查與 release 產生腳本
docs/                     無塵室交付說明
release/html/             可直接雙擊的 HTML 備援版
release/exe/              Windows 免安裝可攜式 EXE
build/                    打包圖示等本機建置資源
```

## 開發端指令

本專案只使用 pnpm，不使用 npm。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
corepack pnpm run smoke
corepack pnpm run build:win
```

第一次尚未產生 lockfile 時使用：

```powershell
corepack pnpm install
```

## 無塵室交付

優先交付：

```text
release/exe/duck-town-extraction-v7.0.0-portable.exe
```

若公司禁止未知 EXE，改交付整個：

```text
release/html/
```

兩種成品都不需要開發工具或網路。Portable EXE 內含 Chromium，因此體積明顯大於 HTML。未簽章 EXE 可能觸發 Windows SmartScreen；正式公司部署應由公司憑證簽章或加入允許清單。

## 供應鏈控制

- pnpm 與 Electron 版本均固定，不使用浮動版本。
- `pnpm-lock.yaml` 必須一同保留於開發專案。
- 正式重建使用 `--frozen-lockfile`。
- 僅允許 Electron 必要的安裝腳本。
- Electron runtime 阻擋 HTTP、HTTPS、WebSocket 與權限請求。
- HTML 另有 CSP 與靜態掃描，防止誤加入外部資源。

pnpm 仍會從套件 registry 下載第三方程式；它不等於自動消除供應鏈風險。正式版本應保留 lockfile、校驗建置成品，並在外部開發環境執行依賴稽核。

