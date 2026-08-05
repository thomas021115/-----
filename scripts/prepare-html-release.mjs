import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const root = process.cwd();
const releaseRoot = path.resolve(root, 'release');
const outputDir = path.join(root, 'release', 'html');
const viteOutput = path.join(outputDir, 'index.html');
const output = path.join(outputDir, 'duck-game.html');

const resolvedOutputDir = path.resolve(outputDir);
if (!resolvedOutputDir.startsWith(`${releaseRoot}${path.sep}`)) {
  throw new Error(`拒絕清理非 release 目錄：${resolvedOutputDir}`);
}

fs.rmSync(resolvedOutputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

await build({
  configFile: path.join(root, 'vite.config.mjs')
});

if (!fs.existsSync(viteOutput)) {
  throw new Error('Vite 未產生 release/html/index.html');
}

fs.renameSync(viteOutput, output);

const entries = fs.readdirSync(outputDir, { withFileTypes: true });
if (entries.length !== 1 || !entries[0].isFile() || entries[0].name !== 'duck-game.html') {
  throw new Error(`單檔輸出失敗：release/html 內容為 ${entries.map((entry) => entry.name).join(', ')}`);
}

const bytes = fs.readFileSync(output);
const html = bytes.toString('utf8');
if (/\b(?:src|href)=["'](?!data:|#)/i.test(html)) {
  throw new Error('建置結果仍包含非內嵌資源');
}
if (/\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\b|EventSource\b|sendBeacon\s*\(|navigator\.serviceWorker)|url\(\s*["']?https?:\/\//i.test(html)) {
  throw new Error('建置結果包含可執行的網路連線程式或外部 CSS 資源');
}

const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

console.log(JSON.stringify({
  status: 'PASS',
  output: path.relative(root, output),
  filesInOutputDirectory: entries.length,
  bytes: bytes.length,
  sha256: hash
}, null, 2));
