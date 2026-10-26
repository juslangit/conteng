// Conteng main process: one square board window that sits on the desktop, a small
// setup window for the room code, and a tray/menu-bar icon to reach both.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isMac = process.platform === 'darwin';
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// CONTENG_PROFILE=<name> runs a second, separate copy (own settings) for testing two people on one machine.
if (process.env.CONTENG_PROFILE) app.setPath('userData', path.join(app.getPath('appData'), `Conteng-${process.env.CONTENG_PROFILE}`));

let settings = {};
let board = null;
let setup = null;
let tray = null;

function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { settings = {}; }
  if (!settings.author) settings.author = crypto.randomUUID();
  if (!settings.size) settings.size = 320;
  saveSettings();
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

// Readable room codes: conteng-xxxx-xxxx-xxxx (60 random bits, no look-alike letters).
function newRoomCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from(crypto.randomBytes(4), b => abc[b % abc.length]).join('');
  return `conteng-${part()}-${part()}-${part()}`;
}

function createBoard() {
  const area = screen.getPrimaryDisplay().workArea;
  const size = settings.size;
  const pos = settings.pos || { x: area.x + area.width - size - 40, y: area.y + 40 };
  board = new BrowserWindow({
    x: pos.x, y: pos.y, width: size, height: size,
    minWidth: 200, minHeight: 200,
    frame: false, transparent: true, hasShadow: true, resizable: true,
    skipTaskbar: true, fullscreenable: false, maximizable: false, minimizable: false,
    acceptFirstMouse: true, // the first click on the board draws, even while another app is active
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  board.setAspectRatio(1);
  if (isMac) {
    // One level below normal windows: under every app, but above Finder's desktop icons,
    // so it still gets clicks (type 'desktop' sits under the icon layer and gets none).
    board.setAlwaysOnTop(true, 'normal', -1);
    board.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true }); // without this the Dock icon comes back
  }
  board.loadFile(path.join(__dirname, 'renderer', 'board.html'));
  const remember = () => {
    if (!board || board.isDestroyed()) return;
    const b = board.getBounds();
    settings.pos = { x: b.x, y: b.y };
    settings.size = b.width;
    saveSettings();
  };
  board.on('moved', remember);
  board.on('resized', remember);
  board.on('closed', () => { board = null; });
}

function openSetup() {
  if (setup) { setup.show(); setup.focus(); return; }
  setup = new BrowserWindow({
    width: 380, height: 430, resizable: false, minimizable: false, maximizable: false,
    title: 'Conteng board', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  setup.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setup.once('ready-to-show', () => { setup.show(); setup.focus(); });
  setup.on('closed', () => { setup = null; });
  if (isMac) app.focus({ steal: true });
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Conteng');
  refreshTrayMenu();
  if (!isMac) tray.on('click', () => board && board.show());
}
function refreshTrayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: settings.room ? `Board: ${settings.room}` : 'No board yet', enabled: false },
    { label: 'Copy board code', enabled: !!settings.room, click: () => clipboard.writeText(settings.room) },
    { label: 'Board settings…', click: openSetup },
    { label: 'Show board', click: () => { if (!board) createBoard(); board.show(); } },
    { type: 'separator' },
    { label: 'Open at login', type: 'checkbox', checked: login, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Quit Conteng', role: 'quit' },
  ]));
}

ipcMain.handle('settings:get', () => ({ room: settings.room || null, author: settings.author, name: settings.name || '' }));
ipcMain.handle('room:new', () => newRoomCode());
ipcMain.handle('room:set', (_e, room, name, keepOpen) => {
  room = String(room || '').trim().toLowerCase();
  if (room.length < 12 || room.length > 64 || !/^[a-z0-9-]+$/.test(room)) return { ok: false, error: 'That code does not look right.' };
  settings.room = room;
  settings.name = String(name || '').trim().slice(0, 40);
  saveSettings();
  refreshTrayMenu();
  if (board) board.webContents.send('room:changed');
  if (setup && !keepOpen) setup.close();
  return { ok: true };
});
ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
ipcMain.on('setup:open', openSetup);
// The board is moved from the page (drag strip), which works the same on Mac and Windows.
ipcMain.handle('board:pos', () => board && board.getPosition());
ipcMain.on('board:move', (_e, x, y) => { if (board) board.setPosition(Math.round(x), Math.round(y)); });
ipcMain.on('board:resize', (_e, size) => {
  if (!board) return;
  const [x, y] = board.getPosition();
  const n = Math.round(Math.min(900, Math.max(200, size)));
  board.setBounds({ x, y, width: n, height: n });
});
ipcMain.on('board:moved', () => {
  if (!board) return;
  const b = board.getBounds();
  settings.pos = { x: b.x, y: b.y };
  settings.size = b.width;
  saveSettings();
});

app.whenReady().then(() => {
  if (isMac && app.dock) app.dock.hide();
  loadSettings();
  // First run: open at login by default (only for the installed app, not `npm start`).
  if (app.isPackaged && !settings.loginSet) {
    app.setLoginItemSettings({ openAtLogin: true });
    settings.loginSet = true;
    saveSettings();
  }
  buildTray();
  createBoard();
  if (!settings.room) openSetup();
});

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (board) board.show(); });
app.on('window-all-closed', (e) => e.preventDefault?.());
