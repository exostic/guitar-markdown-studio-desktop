const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { googleAuth } = require('./googleAuth.cjs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: 'Guitar Markdown Studio',
    backgroundColor: '#0b012e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env.GMS_DEV_SERVER_URL;
  if (devServer) {
    mainWindow.loadURL(devServer);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'apps', 'editor', 'dist', 'index.html');
    mainWindow.loadURL(pathToFileURL(indexPath).toString());
  }
}

app.whenReady().then(() => {
  // The tuner listens to the microphone: grant media requests from our own
  // window (the OS still asks the user once on macOS).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('document:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Ouvrir un cours de guitare',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown et Guitar Pro', extensions: ['md', 'markdown', 'gp', 'gp3', 'gp4', 'gp5', 'gpx'] },
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Guitar Pro', extensions: ['gp', 'gp3', 'gp4', 'gp5', 'gpx'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  // Guitar Pro files are binary: handed over as base64, the renderer
  // translates them to Markdown.
  if (/\.(gp[345x]?)$/i.test(filePath)) {
    return { filePath, bytes: (await fs.readFile(filePath)).toString('base64') };
  }
  return { filePath, content: await fs.readFile(filePath, 'utf8') };
});

ipcMain.handle('document:save', async (_event, { content, filePath }) => {
  let target = filePath;
  if (!target) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Enregistrer le cours',
      defaultPath: 'cours-guitare.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  await fs.writeFile(target, content, 'utf8');
  return { filePath: target };
});

ipcMain.handle('document:export-pdf', async (_event, suggestedFileName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le cours en PDF',
    defaultPath: suggestedFileName || 'cours-guitare.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;

  const pdf = await mainWindow.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'default' },
    preferCSSPageSize: true,
  });
  await fs.writeFile(result.filePath, pdf);
  return { filePath: result.filePath };
});

ipcMain.handle('document:export-html', async (_event, html, suggestedFileName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le cours en HTML',
    defaultPath: suggestedFileName || 'cours-guitare.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return null;

  await fs.writeFile(result.filePath, html, 'utf8');
  return { filePath: result.filePath };
});

ipcMain.handle('google:auth', async (_event, options) => {
  try {
    return await googleAuth(options ?? {});
  } catch (error) {
    return { error: error.message };
  }
});

