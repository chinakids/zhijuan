import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AgentEvent,
  ChapterEntry,
  FsEvent,
  ProjectSummary,
  Proposal,
  ProposalItem,
  AuditItem,
  AuditKind,
  ChapterCheckKind,
  ChapterCheckResult,
  OutlineCard,
  TriageResult,
  SliceEntry,
  DirectorSheet,
  DirectorCheckResult
} from '../shared/types'

const api = {
  // 平台（renderer 据此做平台差异 UI，如自定义标题栏）
  platform: process.platform as string,
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch) as Promise<AppSettings>,

  // 工作区（相关文档落档）
  workspaceStatus: () =>
    ipcRenderer.invoke('workspace:status') as Promise<{ dir: string; inited: boolean; docs: { file: string; name: string }[] }>,
  workspaceInit: () =>
    ipcRenderer.invoke('workspace:init') as Promise<{ ok: boolean; created: string[]; docs: string[] }>,
  workspaceRead: (file: string) => ipcRenderer.invoke('workspace:read', file) as Promise<string | null>,

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
  applyDocEdit: (id: string, rel: string, edits: import('../shared/types').EditItem[]) =>
    ipcRenderer.invoke('doc:applyEdit', id, rel, edits) as Promise<{ ok: boolean; errors?: string[] }>,
  adoptActs: (id: string, chapterRel: string, draftRel: string) =>
    ipcRenderer.invoke('doc:adoptActs', id, chapterRel, draftRel) as Promise<
      | { ok: true; words: number }
      | { ok: false; error: string }
    >,
  listDocs: (id: string, relDir: string) => ipcRenderer.invoke('doc:list', id, relDir) as Promise<{ file: string; name: string; mtime: number }[]>,
  listChapters: (id: string) => ipcRenderer.invoke('chapter:list', id) as Promise<ChapterEntry[]>,
  listSlices: (projectId: string) => ipcRenderer.invoke('slices:list', projectId) as Promise<SliceEntry[]>,

  // 提案（S4）
  listProposals: (id: string) => ipcRenderer.invoke('proposal:list', id) as Promise<Proposal[]>,
  createProposals: (id: string, source: 'slice-sync' | 'agent-chat', chapter: string, slice: string, items: ProposalItem[]) =>
    ipcRenderer.invoke('proposal:create', id, source, chapter, slice, items) as Promise<Proposal[]>,
  applyProposal: (id: string, pid: string) =>
    ipcRenderer.invoke('proposal:apply', id, pid) as Promise<{ ok: boolean; applied: string[]; errors: string[] }>,
  rejectProposal: (id: string, pid: string) => ipcRenderer.invoke('proposal:reject', id, pid) as Promise<boolean>,

  // 文件系统事件（项目目录被外部改动时）
  onFsEvent: (cb: (evt: FsEvent) => void) => {
    const listener = (_e: unknown, evt: FsEvent) => cb(evt)
    ipcRenderer.on('fs:event', listener)
    return () => {
      ipcRenderer.removeListener('fs:event', listener)
    }
  },

  // agent（harness 引擎；流式事件按 requestId 认领）
  agentSend: (input: { requestId: string; projectId: string; chapterRel: string | null; chapterTitle: string; prompt: string; quote?: string | null; history?: { role: 'user' | 'assistant'; content: string }[] }) =>
    ipcRenderer.invoke('agent:send', input) as Promise<{ ok: boolean }>,
  agentCancel: (requestId: string) => ipcRenderer.invoke('agent:cancel', requestId) as Promise<boolean>,
  agentSync: (projectId: string, chapterRel: string) =>
    ipcRenderer.invoke('agent:sync', projectId, chapterRel) as Promise<{ ok: boolean; items: ProposalItem[]; error?: string }>,
  agentAnswer: (batch: string, answers: { id: string; selected: string[]; custom?: string }[]) =>
    ipcRenderer.invoke('agent:answer', batch, answers) as Promise<{ ok: boolean; error?: string }>,
  agentAudit: (projectId: string, kind: AuditKind) =>
    ipcRenderer.invoke('agent:audit', projectId, kind) as Promise<
      | { ok: true; result: { summary: string; items: AuditItem[] }; savedReport?: string }
      | { ok: false; error: string }
    >,
  agentChapterCheck: (projectId: string, chapterRel: string, kind: ChapterCheckKind) =>
    ipcRenderer.invoke('agent:chapterCheck', projectId, chapterRel, kind) as Promise<
      | { ok: true; result: ChapterCheckResult }
      | { ok: false; error: string }
    >,
  agentOutlineRebuild: (projectId: string, only?: string[]) =>
    ipcRenderer.invoke('agent:outlineRebuild', projectId, only) as Promise<
      | { ok: true; cards: OutlineCard[]; written: string[] }
      | { ok: false; error: string }
    >,
  agentDirector: (projectId: string, chapterRel: string) =>
    ipcRenderer.invoke('agent:director', projectId, chapterRel) as Promise<
      | { ok: true; written: string; sheet: DirectorSheet }
      | { ok: false; error: string }
    >,
  agentDirectorCheck: (projectId: string, chapterRel: string) =>
    ipcRenderer.invoke('agent:directorCheck', projectId, chapterRel) as Promise<
      | { ok: true; result: DirectorCheckResult }
      | { ok: false; error: string }
    >,
  agentActs: (projectId: string, chapterRel: string, opts?: { only?: number[]; onlyFailed?: boolean }) =>
    ipcRenderer.invoke('agent:acts', projectId, chapterRel, opts) as Promise<
      | { ok: true; written: string; acts: number; words: number; failed?: number[] }
      | { ok: false; error: string }
    >,
  agentTriage: (projectId: string) =>
    ipcRenderer.invoke('agent:triage', projectId) as Promise<
      | { ok: true; result: TriageResult }
      | { ok: false; error: string }
    >,
  agentStatus: () =>
    ipcRenderer.invoke('agent:status') as Promise<{ online: boolean; provider?: string; model?: string; message?: string }>,
  agentListCapabilities: () =>
    ipcRenderer.invoke('agent:capabilities') as Promise<{ id: string; title: string; description?: string }[]>,
  agentSetCapability: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('agent:setCapability', id, enabled) as Promise<boolean>,
  onAgentEvent: (cb: (evt: AgentEvent) => void) => {
    const listener = (_e: unknown, evt: AgentEvent) => cb(evt)
    ipcRenderer.on('agent:event', listener)
    return () => {
      ipcRenderer.removeListener('agent:event', listener)
    }
  }
}

export type ZhijuanApi = typeof api

contextBridge.exposeInMainWorld('zhijuan', api)
