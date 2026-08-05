import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const toolsDirectory = path.join(root, '.tools', 'bin');
const pnpmShim = path.join(toolsDirectory, process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm');
const builderCli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

function run(command, args, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...extraEnvironment },
      stdio: 'inherit',
      windowsHide: true,
      shell: false
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) return reject(new Error(`${command} terminated by ${signal}`));
      if (code !== 0) return reject(new Error(`${command} exited with code ${code}`));
      resolve();
    });
  });
}

if (process.platform !== 'win32') {
  throw new Error('Windows portable EXE must be built on Windows.');
}

fs.mkdirSync(toolsDirectory, { recursive: true });
if (!fs.existsSync(pnpmShim)) {
  await run('corepack', ['enable', 'pnpm', '--install-directory', toolsDirectory]);
}

const childEnvironment = { ...process.env };
const pathKey = Object.keys(childEnvironment).find((key) => key.toLowerCase() === 'path') || 'PATH';
childEnvironment[pathKey] = `${toolsDirectory}${path.delimiter}${childEnvironment[pathKey] || ''}`;

await run(process.execPath, ['scripts/verify-offline.mjs']);
await run(process.execPath, ['scripts/prepare-html-release.mjs']);
await run(process.execPath, [builderCli, '--win', 'portable', '--x64'], childEnvironment);
await run(process.execPath, ['scripts/verify-release.mjs']);

const releaseExeDirectory = path.resolve(root, 'release', 'exe');
const unpackedDirectory = path.resolve(releaseExeDirectory, 'win-unpacked');
if (
  unpackedDirectory.startsWith(`${releaseExeDirectory}${path.sep}`)
  && path.basename(unpackedDirectory) === 'win-unpacked'
  && fs.existsSync(unpackedDirectory)
) {
  fs.rmSync(unpackedDirectory, { recursive: true, force: true });
}
