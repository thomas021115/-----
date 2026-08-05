'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, session } = require('electron');

const smokeTest = process.argv.includes('--smoke-test');
const releaseHtmlTest = process.argv.includes('--release-html');
const blockedNetworkRequests = [];
const smokeUserDataDirectory = smokeTest
  ? path.join(app.getPath('temp'), `duck-town-extraction-smoke-${process.pid}`)
  : null;

if (smokeUserDataDirectory) app.setPath('userData', smokeUserDataDirectory);

// The release must stay offline even if future game code accidentally adds a URL.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch(
  'disable-features',
  'AutofillServerCommunication,MediaRouter,NetworkTimeServiceQuerying,OptimizationHints'
);

function installOfflineGuards() {
  const filter = {
    urls: [
      'http://*/*',
      'https://*/*',
      'ws://*/*',
      'wss://*/*'
    ]
  };

  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    blockedNetworkRequests.push(details.url);
    callback({ cancel: true });
  });

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#050908',
    title: '鴨鎮撤離行動',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });

  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  const gameFile = releaseHtmlTest
    ? path.join(__dirname, '..', 'release', 'html', 'duck-game.html')
    : path.join(__dirname, '..', 'src', 'game', 'index.html');

  win.loadFile(
    gameFile,
    smokeTest ? { query: { selftest: '1' } } : undefined
  );

  win.once('ready-to-show', () => {
    if (!smokeTest) {
      win.maximize();
      win.show();
    }
  });

  if (smokeTest) {
    const timeout = setTimeout(() => {
      console.error('SMOKE TEST FAIL: load timeout');
      app.exit(1);
    }, 15000);

    win.webContents.once('did-finish-load', async () => {
      try {
        const result = await win.webContents.executeJavaScript(`(async () => {
          const selftestText = document.getElementById('selftestResult')?.textContent || '';
          let selftest = null;
          try { selftest = JSON.parse(selftestText); } catch (_error) {}
          let uiShell = null;
          if (${releaseHtmlTest ? 'true' : 'false'} && window.__duckUi) {
            const routeChecks = [];
            for (const path of window.__duckUi.pages) {
              await window.__duckUi.go(path);
              await new Promise((resolve) => setTimeout(resolve, 20));
              const expectedPage = path.slice(1);
              const visiblePages = [...document.querySelectorAll('[data-lobby-page]')]
                .filter((section) => !section.classList.contains('lobbyPageHidden'))
                .map((section) => section.dataset.lobbyPage);
              routeChecks.push({
                path,
                hash: location.hash,
                visiblePages,
                pass: location.hash === '#' + path
                  && visiblePages.length > 0
                  && visiblePages.every((page) => page === expectedPage)
              });
            }
            uiShell = {
              routeCount: document.querySelectorAll('[data-ui-route]').length,
              routeChecks,
              allRoutesPass: routeChecks.length === 5 && routeChecks.every((check) => check.pass)
            };
            await window.__duckUi.go('/home');
          }
          return {
            title: document.title,
            canvas: !!document.getElementById('game'),
            startButton: !!document.getElementById('startRaidBtn'),
            difficultyCards: document.querySelectorAll('[data-difficulty]').length,
            debugApi: typeof window.__duckDebug === 'object',
            uiShell,
            bodyText: document.body.innerText.length,
            selftest
          };
        })()`);
        const pass = result.title === 'SELFTEST PASS'
          && result.canvas
          && result.startButton
          && result.difficultyCards === 4
          && result.debugApi
          && result.bodyText > 100
          && result.selftest?.pass === true
          && result.selftest?.maps?.length === 3
          && (!releaseHtmlTest || (
            result.uiShell?.routeCount === 5
            && result.uiShell?.allRoutesPass === true
          ));
        console.log(JSON.stringify({
          smoke: pass ? 'PASS' : 'FAIL',
          target: releaseHtmlTest ? 'release/html/duck-game.html' : 'src/game/index.html',
          blockedNetworkRequests,
          result
        }));
        clearTimeout(timeout);
        app.exit(pass && blockedNetworkRequests.length === 0 ? 0 : 1);
      } catch (error) {
        clearTimeout(timeout);
        console.error(`SMOKE TEST FAIL: ${error.stack || error}`);
        app.exit(1);
      }
    });
  }

  return win;
}

app.whenReady().then(() => {
  installOfflineGuards();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !smokeTest) createWindow();
  });
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('window-all-closed', () => app.quit());

app.on('quit', () => {
  if (!smokeUserDataDirectory) return;
  const temporaryRoot = path.resolve(app.getPath('temp'));
  const target = path.resolve(smokeUserDataDirectory);
  if (
    target.startsWith(`${temporaryRoot}${path.sep}`)
    && path.basename(target).startsWith('duck-town-extraction-smoke-')
  ) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (_error) {
      // Windows may keep Chromium files locked briefly; the OS temp cleaner can remove them later.
    }
  }
});
