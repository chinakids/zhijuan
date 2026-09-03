// ===== 织卷 V2 · IPC 路由（renderer 唯一入口） =====
import { ipcMain, shell, BrowserWindow } from 'electron'
import type { AppSettings, FsEvent, ProposalItem } from '../shared/types'
import { listProposals, createProposals, applyProposal, rejectProposal } from './proposals'
import {
  getSettings,
  setSettings,
  libraryRoot,
  listProjects,
  createProject,
  removeProject,
  importProject,
  projectDir,
  readDoc,
  writeDoc,
  listDocs,
  listChapters,
  watchProject
} from './store'

export function broadcastToAll(evt: FsEvent) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('fs:event', evt)
  }
}

export function registerIpc() {
  // 设置
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => setSettings(patch))

  // 项目
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:create', (_e, name: string, description: string) => createProject(name, description))
  ipcMain.handle('project:remove', (_e, id: string) => removeProject(id))
  ipcMain.handle('project:import', (_e, dir: string) => importProject(dir))
  ipcMain.handle('project:reveal', (_e, id: string) => {
    shell.showItemInFolder(projectDir(id))
  })
  ipcMain.handle('project:open', (_e, id: string) => {
    watchProject(id, (evt) => broadcastToAll(evt))
    return true
  })
  ipcMain.handle('app:getPaths', () => ({
    documents: libraryRoot(),
    defaultLibrary: shell ? String(process.env.HOME) : ''
  }))

  // 文档（相对项目根）
  ipcMain.handle('doc:read', (_e, id: string, rel: string) => readDoc(id, rel))
  ipcMain.handle('doc:write', (_e, id: string, rel: string, content: string) => {
    writeDoc(id, rel, content)
    return true
  })
  ipcMain.handle('doc:list', (_e, id: string, relDir: string) => listDocs(id, relDir))
  ipcMain.handle('chapter:list', (_e, id: string) => listChapters(id))

  // 提案（S4）
  ipcMain.handle('proposal:list', (_e, id: string) => listProposals(libraryRoot(), id))
  ipcMain.handle('proposal:create', (_e, id: string, source: 'slice-sync' | 'agent-chat', chapter: string, slice: string, items: ProposalItem[]) => createProposals(libraryRoot(), id, source, chapter, slice, items))
  ipcMain.handle('proposal:apply', (_e, id: string, pid: string) => applyProposal(libraryRoot(), id, pid))
  ipcMain.handle('proposal:reject', (_e, id: string, pid: string) => rejectProposal(libraryRoot(), id, pid))
}
