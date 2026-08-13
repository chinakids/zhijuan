import { contextBridge, ipcRenderer } from 'electron'
import type { Project, Chapter } from '../shared/types'

const api = {
  // 项目管理
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (name: string, description: string) => ipcRenderer.invoke('project:create', name, description),
  loadProject: (id: string) => ipcRenderer.invoke('project:load', id),
  saveProject: (p: Project) => ipcRenderer.invoke('project:save', p),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  // 章节导出
  exportChapter: (project: Project, chapter: Chapter) => ipcRenderer.invoke('chapter:export', project, chapter),
  // 生成
  generate: (project: Project, chapter: Chapter, opts: { baseUrl: string; model: string; apiKey: string }) =>
    ipcRenderer.invoke('gen:generate', project, chapter, opts),
  abortGenerate: () => ipcRenderer.invoke('gen:abort'),
  // 环境
  getPaths: () => ipcRenderer.invoke('app:getPaths')
}

export type ZhijuanApi = typeof api

contextBridge.exposeInMainWorld('zhijuan', api)
