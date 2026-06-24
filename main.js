const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { registerAPI1, api1State } = require('./api1');

// Linux display fixes — two separate causes of a blank window on Linux:
//  1) Wayland: Electron defaults to Xwayland and renders the page but never
//     presents it, leaving the window blank. ozone-platform-hint=auto uses
//     native Wayland when available (and falls back to X11 otherwise).
//  2) GPU process: on some VMs/drivers it can't launch and Electron aborts with
//     "GPU process isn't usable. Goodbye." before showing anything; fall back to
//     software rendering so the window always appears.
// macOS/Windows keep hardware acceleration (their GPU path works fine).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

console.log('MAIN.JS __dirname:', __dirname);
console.log('PRELOAD PATH:', path.join(__dirname, 'preload.js'));
console.log(
  'Does preload exist?',
  require('fs').existsSync(path.join(__dirname, 'preload.js'))
);

// Add hot reload in development
try {
  require('electron-reloader')(module, {
    ignore: [/tor-manager[\\/]target/],
    watchRenderer: true,
  });
} catch (_) {}

let torManager = null;

function startManagedTor() {
  if (process.env.COINSWAP_DISABLE_MANAGED_TOR === '1') {
    console.log('[tor-manager] Managed Tor startup disabled by environment');
    return;
  }

  const TOR_BINARY = process.platform === 'win32' ? 'coinswap-tor-manager.exe' : 'coinswap-tor-manager';
  // Packaged app: binary is in bin/ (copied by prepare-dist.js)
  // Dev: binary is in tor-manager/target/debug/ (built by cargo)
  const torManagerPath = app.isPackaged
    ? path.join(__dirname, 'bin', TOR_BINARY)
    : path.join(__dirname, 'tor-manager', 'target', 'debug', TOR_BINARY);

  if (!fs.existsSync(torManagerPath)) {
    console.warn(
      `[tor-manager] ${torManagerPath} not found; Tor will not be auto-started`
    );
    return;
  }

  console.log('[tor-manager] Starting:', torManagerPath);
  torManager = spawn(torManagerPath, [], {
    stdio: 'inherit',
    windowsHide: true,
  });

  torManager.on('error', (error) => {
    console.error('[tor-manager] failed to start:', error);
    torManager = null;
  });

  torManager.on('exit', (code) => {
    if (code) {
      console.warn(`[tor-manager] exited with code ${code}`);
    }
    torManager = null;
  });
}

function stopManagedTor() {
  if (torManager && torManager.exitCode === null) torManager.kill();
}

/**
 * Create the main application window
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'assets/coinswap.png'),
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  const htmlPath = path.join(__dirname, 'src', 'index.html');
  console.log('Loading file from:', htmlPath);

  win.loadFile(htmlPath);

  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript('localStorage.clear();');
    console.log('🧹 localStorage cleared');
  });

  // Clear swap state on startup
  try {
    const stateFile = path.join(api1State.DATA_DIR, 'swap_state.json');
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      console.log('🧹 Swap state cleared');
    }
  } catch (error) {
    console.warn('⚠️ Could not clear swap state:', error.message);
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

/**
 * App lifecycle
 */

app.whenReady().then(async () => {
  console.log('🚀 Electron app starting...');

  startManagedTor();

  // Register API v1 handlers
  registerAPI1();

  createWindow();
});

app.on('before-quit', () => {
  stopManagedTor();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

console.log('🚀 API v1-enabled Electron app starting...');
