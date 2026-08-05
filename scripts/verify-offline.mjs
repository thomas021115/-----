import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requestedPath = process.argv[2] || path.join('src', 'game', 'index.html');
const htmlPath = path.resolve(root, requestedPath);
if (!fs.existsSync(htmlPath)) {
  console.error(JSON.stringify({ status: 'FAIL', file: requestedPath, failures: ['找不到 HTML 檔案'] }, null, 2));
  process.exit(1);
}
const html = fs.readFileSync(htmlPath, 'utf8');
const failures = [];
const releaseArtifact = path.relative(root, htmlPath).split(path.sep).join('/') === 'release/html/duck-game.html';

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(/^<!DOCTYPE html>/i.test(html), '缺少 HTML5 DOCTYPE');
check(/<html\b[^>]*lang="zh-Hant"/i.test(html), '缺少 zh-Hant 語言設定');
check(/connect-src\s+'none'/i.test(html), 'CSP 未禁止網路連線');

const forbiddenPatterns = [
  [/\bfetch\s*\(/i, '包含 fetch()'],
  [/\bXMLHttpRequest\b/i, '包含 XMLHttpRequest'],
  [/\bWebSocket\b/i, '包含 WebSocket'],
  [/\bEventSource\b/i, '包含 EventSource'],
  [/\bsendBeacon\s*\(/i, '包含 sendBeacon()'],
  [/navigator\.serviceWorker/i, '包含 Service Worker'],
  [/url\(\s*["']?https?:\/\//i, '包含外部 CSS 資源']
];

for (const [pattern, message] of forbiddenPatterns) {
  check(!pattern.test(html), message);
}

const resourcePattern = /\b(?:src|href)="([^"]+)"/gi;
for (const match of html.matchAll(resourcePattern)) {
  const embedded = match[1].startsWith('data:') || match[1].startsWith('#');
  const localSourceFile = !releaseArtifact
    && !/^(?:[a-z]+:)?\/\//i.test(match[1])
    && !match[1].startsWith('\\\\');
  check(
    embedded || localSourceFile,
    `發現非內嵌資源：${match[1]}`
  );
}

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => !/\bsrc=/i.test(match[1]) && match[2].trim());
check(inlineScripts.length > 0, '找不到內嵌 JavaScript');
for (const scriptMatch of inlineScripts) {
  try {
    new Function(scriptMatch[2]);
  } catch (error) {
    failures.push(`JavaScript 語法錯誤：${error.message}`);
  }
}

const ids = [...html.matchAll(/\bid="([^"]+)"/gi)].map((match) => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
check(duplicateIds.length === 0, `重複 DOM ID：${[...new Set(duplicateIds)].join(', ')}`);

const referencedIds = [...html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)]
  .map((match) => match[1]);
const missingIds = [...new Set(referencedIds)].filter((id) => !ids.includes(id));
check(missingIds.length === 0, `缺少 DOM ID：${missingIds.join(', ')}`);

const imageMatch = html.match(/data:image\/jpeg;base64,([^"']+)/i);
check(Boolean(imageMatch), '找不到內嵌 JPEG');
let embeddedImageBytes = 0;
if (imageMatch) {
  const bytes = Buffer.from(imageMatch[1], 'base64');
  embeddedImageBytes = bytes.length;
  check(bytes[0] === 0xff && bytes[1] === 0xd8, '內嵌 JPEG 標頭不正確');
  check(bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9, '內嵌 JPEG 結尾不正確');
}

const result = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  file: path.relative(root, htmlPath),
  bytes: Buffer.byteLength(html),
  domIds: ids.length,
  scriptBytes: inlineScripts.reduce((sum, match) => sum + Buffer.byteLength(match[2]), 0),
  embeddedImageBytes,
  failures
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
