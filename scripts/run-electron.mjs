import { spawn } from 'node:child_process';
import electron from 'electron';

const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: 'inherit',
  windowsHide: false
});

child.once('error', (error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron terminated by signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
