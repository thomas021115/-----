import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const outputDir = path.join(root, 'release', 'html');
const htmlPath = path.join(outputDir, 'duck-game.html');
const failures = [];
const entries = fs.existsSync(outputDir)
  ? fs.readdirSync(outputDir, { withFileTypes: true })
  : [];

if (entries.length !== 1 || !entries[0]?.isFile() || entries[0].name !== 'duck-game.html') {
  failures.push(`release/html 必須只有 duck-game.html，實際為：${entries.map((entry) => entry.name).join(', ') || '空目錄'}`);
}
if (!fs.existsSync(htmlPath)) failures.push('缺少 release/html/duck-game.html');

let htmlBytes = 0;
let sha256 = '';
if (fs.existsSync(htmlPath)) {
  const bytes = fs.readFileSync(htmlPath);
  const html = bytes.toString('utf8');
  htmlBytes = bytes.length;
  sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (!/^<!DOCTYPE html>/i.test(html)) failures.push('成品缺少 HTML5 DOCTYPE');
  if (!/connect-src\s+'none'/i.test(html)) failures.push('成品 CSP 未禁止網路連線');
  if (/https?:\/\//i.test(html)) failures.push('成品包含 HTTP/HTTPS URL');
  if (/\b(?:src|href)=["'](?!data:|#)/i.test(html)) failures.push('成品包含非內嵌資源');
}

const result = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  file: path.relative(root, htmlPath),
  filesInOutputDirectory: entries.length,
  htmlBytes,
  sha256,
  failures
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
