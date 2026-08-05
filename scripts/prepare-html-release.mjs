import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'src', 'game', 'index.html');
const outputDir = path.join(root, 'release', 'html');
const output = path.join(outputDir, 'duck-game.html');

fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(source, output);

const bytes = fs.readFileSync(output);
const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
fs.writeFileSync(
  path.join(outputDir, 'SHA256SUMS.txt'),
  `${hash}  duck-game.html\r\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(outputDir, 'README.txt'),
  [
    '鴨鎮撤離行動－單一 HTML 離線版',
    '',
    '1. 不需要安裝 VS Code、Node.js、pnpm 或任何套件。',
    '2. 在無網路狀態下直接雙擊 duck-game.html。',
    '3. 建議使用公司既有的最新版 Edge 或 Chrome。',
    '4. 遊戲進度保存在該瀏覽器對本機檔案提供的 LocalStorage。',
    '5. 複製到另一台電腦時，遊戲檔可執行，但瀏覽器存檔不會自動跟著複製。',
    '',
    `SHA-256: ${hash}`,
    ''
  ].join('\r\n'),
  'utf8'
);

console.log(JSON.stringify({ output: path.relative(root, output), bytes: bytes.length, sha256: hash }, null, 2));

