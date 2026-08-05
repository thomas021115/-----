# 鴨鎮撤離行動－離線建置專案

這個資料夾是外部開發環境。無塵室只接收 `release/html/duck-game.html`，不接收 `node_modules`，也不需要安裝 VS Code、Node.js、pnpm 或任何套件。

## 資料夾

```text
src/game/index.html       遊戲 HTML 原始碼
vite.config.mjs           單一 HTML 建置設定
electron/main.cjs         僅供外部開發端相容性自測
scripts/                  離線檢查與 release 產生腳本
docs/                     無塵室交付說明
release/html/duck-game.html  唯一可交付成品
release/exe/              舊版 EXE 建置輸出，不可帶入無塵室
build/                    打包圖示等本機建置資源
```

## 開發端指令

本專案只使用 pnpm，不使用 npm。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
corepack pnpm run build:html
corepack pnpm run verify:html
corepack pnpm run verify:release
corepack pnpm run smoke
```

第一次尚未產生 lockfile 時使用：

```powershell
corepack pnpm install
```

## 無塵室交付

只交付這一個檔案：

```text
release/html/duck-game.html
```

成品內已包含 JavaScript、CSS 與圖片。無塵室使用公司既有的 Edge 或 Chrome 雙擊開啟，不需要開發工具、安裝程序或網路。不要交付 EXE、README、校驗文字檔或其他附件。

## 供應鏈控制

- pnpm、Vite、Vue 與建置外掛版本均固定，不使用浮動版本。
- `pnpm-lock.yaml` 必須一同保留於開發專案。
- 正式重建使用 `--frozen-lockfile`。
- Vite single-file 建置後強制確認 `release/html` 只有一個 HTML。
- HTML 具有 CSP 與靜態掃描，防止誤加入外部資源與網路連線。

pnpm 仍會從套件 registry 下載第三方程式；它不等於自動消除供應鏈風險。正式版本應保留 lockfile、校驗建置成品，並在外部開發環境執行依賴稽核。
