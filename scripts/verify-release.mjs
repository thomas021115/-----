import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const html = path.join(root, 'release', 'html', 'duck-game.html');
const exeDir = path.join(root, 'release', 'exe');
const executables = fs.existsSync(exeDir)
  ? fs.readdirSync(exeDir).filter((name) => name.endsWith('-portable.exe'))
  : [];

const failures = [];
if (!fs.existsSync(html)) failures.push('缺少 release/html/duck-game.html');
if (executables.length !== 1) failures.push(`預期 1 個 portable EXE，實際為 ${executables.length} 個`);

const executableDetails = executables.map((name) => {
  const filePath = path.join(exeDir, name);
  const bytes = fs.readFileSync(filePath);
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) failures.push(`${name} 缺少 Windows MZ 標頭`);
  return {
    name,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase()
  };
});

if (executableDetails.length === 1) {
  const executable = executableDetails[0];
  fs.writeFileSync(
    path.join(exeDir, 'SHA256SUMS.txt'),
    `${executable.sha256}  ${executable.name}\r\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(exeDir, 'README.txt'),
    [
      '鴨鎮撤離行動－Windows x64 可攜式離線版',
      '',
      `啟動檔：${executable.name}`,
      '不需安裝，不需 VS Code、Node.js、pnpm 或網路。',
      '雙擊 EXE 即可啟動，F11 可切換全螢幕。',
      '正式帶入前請由公司資訊安全政策核准此 EXE。',
      '',
      `SHA-256: ${executable.sha256}`,
      ''
    ].join('\r\n'),
    'utf8'
  );
}

const result = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  htmlBytes: fs.existsSync(html) ? fs.statSync(html).size : 0,
  executables: executableDetails,
  failures
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
