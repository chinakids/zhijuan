import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ChapterEntry, FsEvent, ProjectSummary } from '../shared/types'

const api = {
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch) as Promise<AppSettings>,

  // 项目
  listProjects: () => ipcRenderer.invoke('project:list') as Promise<ProjectSummary[]>,
  createProject: (name: string, description: string) =>
    ipcRenderer.invoke('project:create', name, description) as Promise<ProjectSummary | null>,
  removeProject: (id: string) => ipcRenderer.invoke('project:remove', id) as Promise<{ ok: boolean; error?: string }>,
  importProject: (dir: string) => ipcRenderer.invoke('project:import', dir) as Promise<ProjectSummary | null>,
  revealProject: (id: string) => ipcRenderer.invoke('project:reveal', id),
  openProject: (id: string) => ipcRenderer.invoke('project:open', id) as Promise<boolean>,

  // 文档（相对项目根）
  readDoc: (id: string, rel: string) => ipcRenderer.invoke('doc:read', id, rel) as Promise<string | null>,
  writeDoc: (id: string, rel: string, content: string) => ipcRenderer.invoke('doc:write', id, rel, content) as Promise<boolean>,
  listDocs: (id: string, relDir: string) => ipcRenderer.invoke('doc:list', id, relDir) as Promise<{ file: string; name: string; mtime: number }[]>,
  listChapters: (id: string) => ipcRenderer.invoke('chapter:list', id) as Promise<ChapterEntry[]>,

  // 文件系统事件（项目目录被外部改动时）
  onFsEvent: (cb: (evt: FsEvent) => void) => {
    const listener = (_e: unknown, evt: FsEvent) => cb(evt)
    ipcRenderer.on('fs:event', listener)
    return () => {
      ipcRenderer.removeListener('fs:event', listener)
    }
  }
}

export type ZhijuanApi = typeof api

contextBridge.exposeInMainWorld('zhijuan', api)
