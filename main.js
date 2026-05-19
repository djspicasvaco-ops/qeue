const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');

let win = null;
let tray = null;
let serverProcess = null;
let serverReady = false;

const SERVER_PORT = 7842;
const IS_MAC = process.platform === 'darwin';

function getPythonPath() {
  const bundled = path.join(process.resourcesPath || __dirname, 'python-bundled');
  if (process.platform === 'win32') {
    const exe = path.join(bundled, 'python', 'python.exe');
    if (fs.existsSync(exe)) return exe;
    return 'python';
  }
  const bin = path.join(bundled, 'bin', 'python3');
  if (fs.existsSync(bin)) return bin;
  return 'python3';
}

function getServerScriptPath() {
  const bundled = path.join(process.resourcesPath || __dirname, 'server.py');
  if (fs.existsSync(bundled)) return bundled;
  return path.join(__dirname, 'server.py');
}

function startServer() {
  const script = getServerScriptPath();
  if (!fs.existsSync(script)) {
    console.log('[server] no server.py found, running without engine');
    return;
  }
  const py = getPythonPath();
  try {
    serverProcess = spawn(py, [script, '--port', String(SERVER_PORT)], {
      cwd: path.dirname(script),
      env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    serverProcess.on('error', function(e) {
      console.log('[server] could not start:', e.message);
      serverProcess = null;
    });
    serverProcess.stdout.on('data', function(d) { console.log('[server]', d.toString().trim()); });
    serverProcess.stderr.on('data', function(d) { console.error('[server]', d.toString().trim()); });
    serverProcess.on('exit', function() { serverReady = false; });
    pollServer(0);
  } catch(e) {
    console.log('[server] spawn failed:', e.message);
  }
}

function pollServer(attempts) {
  if (attempts > 20) return;
  http.get('http://127.0.0.1:' + SERVER_PORT + '/api/health', function(res) {
    if (res.statusCode === 200) {
      serverReady = true;
      console.log('[server] ready');
      if (win) win.webContents.send('server-ready');
    }
  }).on('error', function() {
    setTimeout(function() { pollServer(attempts + 1); }, 2000);
  });
}

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  const keys = Object.keys(ifaces);
  for (let i = 0; i < keys.length; i++) {
    const list = ifaces[keys[i]];
    for (let j = 0; j < list.length; j++) {
      if (list[j].family === 'IPv4' && !list[j].internal) return list[j].address;
    }
  }
  return '127.0.0.1';
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Qeue',
    backgroundColor: '#050509',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  win.loadFile(path.join(__dirname, 'app', 'loading.html'));

  win.once('ready-to-show', function() {
    win.show();
    setTimeout(function() {
      win.loadFile(path.join(__dirname, 'app', 'index.html'));
    }, 1500);
  });

  win.on('closed', function() { win = null; });

  win.webContents.setWindowOpenHandler(function(details) {
    if (details.url.startsWith('http')) shell.openExternal(details.url);
    return { action: 'deny' };
  });
}

function createTray() {
  var img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Qeue');
  var menu = Menu.buildFromTemplate([
    { label: 'Open Qeue', click: function() { if (win) win.show(); else createWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: function() { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', function() { if (win) win.show(); });
}

ipcMain.handle('get-local-ip', function() { return getLocalIP(); });
ipcMain.handle('get-server-port', function() { return SERVER_PORT; });
ipcMain.handle('is-server-ready', function() { return serverReady; });
ipcMain.handle('get-app-version', function() { return app.getVersion(); });

app.whenReady().then(function() {
  createWindow();
  createTray();
  startServer();
  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function() {
  if (!IS_MAC) app.quit();
});

app.on('before-quit', function() {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
