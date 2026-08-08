import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { BoardTrackerDatabase } from './database';
let database: BoardTrackerDatabase;
const seedPath = (): string => app.isPackaged ? path.join(process.resourcesPath, 'seed_data.json') : path.join(app.getAppPath(), 'assets', 'seed_data.json');
const importSeedData = (): { inserted: number; skipped: number } => database.importSeedCompanies(JSON.parse(fs.readFileSync(seedPath(), 'utf8')));
function createWindow(): void { const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 960, minHeight: 640, title: 'Board Tracker', webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } }); const devServer = process.env.VITE_DEV_SERVER_URL; if (devServer) window.loadURL(devServer); else window.loadFile(path.join(__dirname, '../renderer/index.html')); }
function registerHandlers(): void {
  ipcMain.handle('dashboard:get', () => database.dashboard());
  ipcMain.handle('companies:list', (_e, search?: string) => database.listCompanies(search)); ipcMain.handle('companies:get', (_e, id: number) => database.getCompany(id)); ipcMain.handle('companies:create', (_e, input) => database.createCompany(input)); ipcMain.handle('companies:update', (_e, id, input) => database.updateCompany(id, input)); ipcMain.handle('companies:delete', (_e, id) => database.deleteCompany(id));
  ipcMain.handle('positions:create', (_e, input) => database.createPosition(input)); ipcMain.handle('positions:update', (_e, id, input) => database.updatePosition(id, input)); ipcMain.handle('positions:delete', (_e, id) => database.deletePosition(id));
  ipcMain.handle('compensation:create', (_e, input) => database.createCompensation(input)); ipcMain.handle('compensation:update', (_e, id, input) => database.updateCompensation(id, input)); ipcMain.handle('compensation:delete', (_e, id) => database.deleteCompensation(id));
  ipcMain.handle('instrument-types:list', () => database.listInstrumentTypes()); ipcMain.handle('instrument-types:create', (_e, input) => database.createInstrumentType(input)); ipcMain.handle('instrument-types:update', (_e, id, input) => database.updateInstrumentType(id, input)); ipcMain.handle('instrument-types:delete', (_e, id) => database.deleteInstrumentType(id));
  ipcMain.handle('vesting-schedules:create', (_e, input) => database.createVestingSchedule(input)); ipcMain.handle('vesting-schedules:update', (_e, id, input) => database.updateVestingSchedule(id, input)); ipcMain.handle('vesting-schedules:delete', (_e, id) => database.deleteVestingSchedule(id));
  ipcMain.handle('seed:import', () => importSeedData());
}
app.whenReady().then(() => { database = new BoardTrackerDatabase(path.join(app.getPath('userData'), 'board-tracker.db')); registerHandlers(); importSeedData(); Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'File', submenu: [{ label: 'Import Seed Data', click: () => { importSeedData(); BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('seed-imported')); } }, { role: 'quit' }] }, { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }])); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); }); app.on('before-quit', () => database?.close());
