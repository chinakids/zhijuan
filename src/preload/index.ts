import { contextBridge, ipcRenderer } from 'electron'
import type { Project, Chapter } from '../shared/types'
import type { SweepDraft } from '../shared/types'

const api = {
  // 项目管理
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (name: string, description: string) => ipcRenderer.invoke('project:create', name, description),
  loadProject: (id: string) => ipcRenderer.invoke('project:load', id),
  saveProject: (p: Project) => ipcRenderer.invoke('project:save', p),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  // 章节导出
  exportChapter: (project: Project, chapter: Chapter) => ipcRenderer.invoke('chapter:export', project, chapter),
  // 生成（fromAct 可选：回滚到第 fromAct 幕起重新生成，前面幕的正文保留）
  generate: (project: Project, chapter: Chapter, opts: { baseUrl: string; model: string; apiKey: string }, fromAct?: number) =>
    ipcRenderer.invoke('gen:generate', project, chapter, opts, fromAct) as Promise<{
      ok: boolean
      text?: string
      acts?: string[]
      prompt?: string
      composition?: string
      error?: string
    }>,
  abortGenerate: () => ipcRenderer.invoke('gen:abort'),
  // 章节审计（AI 只出草稿，确认在渲染层）
  auditGenerate: (project: Project, chapter: Chapter, opts: { baseUrl: string; model: string; apiKey: string }) =>
    ipcRenderer.invoke('audit:generate', project, chapter, opts) as Promise<{ ok: boolean; drafts?: SweepDraft[]; prompt?: string; error?: string }>,
  // 沉淀为条目（把一段文字交给模型拆成条目草稿）
  meltConvert: (text: string, atChapter: number, opts: { baseUrl: string; model: string; apiKey: string }) =>
    ipcRenderer.invoke('melt:convert', text, atChapter, opts) as Promise<{ ok: boolean; drafts?: SweepDraft[]; error?: string; elements?: unknown[] }>,
  // 环境
  getPaths: () => ipcRenderer.invoke('app:getPaths')
}

export type ZhijuanApi = typeof api

contextBridge.exposeInMainWorld('zhijuan', api)
