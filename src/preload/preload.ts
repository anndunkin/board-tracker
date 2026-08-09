import { contextBridge, ipcRenderer } from 'electron';
import type { BoardTrackerApi } from '../shared/types';
const api: BoardTrackerApi = {
  dashboard: () => ipcRenderer.invoke('dashboard:get'),
  companies: { list: (search) => ipcRenderer.invoke('companies:list', search), get: (id) => ipcRenderer.invoke('companies:get', id), create: (input) => ipcRenderer.invoke('companies:create', input), update: (id, input) => ipcRenderer.invoke('companies:update', id, input), delete: (id) => ipcRenderer.invoke('companies:delete', id) },
  positions: { create: (input) => ipcRenderer.invoke('positions:create', input), update: (id, input) => ipcRenderer.invoke('positions:update', id, input), delete: (id) => ipcRenderer.invoke('positions:delete', id) },
  compensation: { create: (input) => ipcRenderer.invoke('compensation:create', input), update: (id, input) => ipcRenderer.invoke('compensation:update', id, input), delete: (id) => ipcRenderer.invoke('compensation:delete', id) },
  instrumentTypes: { list: () => ipcRenderer.invoke('instrument-types:list'), create: (input) => ipcRenderer.invoke('instrument-types:create', input), update: (id, input) => ipcRenderer.invoke('instrument-types:update', id, input), delete: (id) => ipcRenderer.invoke('instrument-types:delete', id) },
  vestingSchedules: { create: (input) => ipcRenderer.invoke('vesting-schedules:create', input), update: (id, input) => ipcRenderer.invoke('vesting-schedules:update', id, input), delete: (id) => ipcRenderer.invoke('vesting-schedules:delete', id) },
  documents: { create: (input) => ipcRenderer.invoke('documents:create', input), update: (id, input) => ipcRenderer.invoke('documents:update', id, input), delete: (id) => ipcRenderer.invoke('documents:delete', id), pickFile: () => ipcRenderer.invoke('documents:pick-file'), open: (filePath) => ipcRenderer.invoke('documents:open', filePath) },
  importSeedData: () => ipcRenderer.invoke('seed:import'),
  extractedImport: { pickFile: () => ipcRenderer.invoke('extracted-import:pick-file'), preview: (contents, sourceLabel, selections) => ipcRenderer.invoke('extracted-import:preview', contents, sourceLabel, selections ?? {}), commit: (contents, sourceLabel, selections) => ipcRenderer.invoke('extracted-import:commit', contents, sourceLabel, selections ?? {}), batches: () => ipcRenderer.invoke('extracted-import:batches'), copyPrompt: () => ipcRenderer.invoke('extracted-import:copy-prompt') }
};
contextBridge.exposeInMainWorld('boardTracker', api);
