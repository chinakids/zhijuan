import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AgentEvent,
  ChapterEntry,
  FsEvent,
  ImportResult,
  ExportResult,
  ProjectSummary,
  ProjectTemplate,
  Proposal,
  ProposalItem,
  SyncIssue,
  SyncEvidence,
  SyncLogEntry,
  SaveTraceEntry,
  AuditItem,
  AuditKind,
  ChapterCheckKind,
  ChapterCheckResult,
  OutlineCard,
  TriageResult,
  SliceEntry,
  DirectorSheet,
  DirectorCheckResult,
  UnlistedHit,
  MissingHit,
  HistorySnapshot,
  LibraryCategory,
  SearchHit,
  RecentLibraryDoc,
  MenuActionEvent,
  MenuStateReport
} from '../shared/types'
import type { RecentEntry } from '../shared/projects'
import type { LineInfo } from '../shared/line'

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

  // 平台路径（主进程解析后的生效库根等；设置页「当前」展示用）
  getPaths: () => ipcRenderer.invoke('app:getPaths') as Promise<{ documents: string; defaultLibrary: string }>,
  // 首页「更改库根路径」：系统目录选择器 → 写入设置 → 返回新生效库根（模块设计 §四 A「库根路径（可改）」）
  pickLibrary: () => ipcRenderer.invoke('settings:pickLibrary') as Promise<string | null>,

  // 项目
  listProjects: () => ipcRenderer.invoke('project:list') as Promise<ProjectSummary[]>,
  createProject: (name: string, description: string, template?: string) =>
    ipcRenderer.invoke('project:create', name, description, template) as Promise<ProjectSummary | null>,
  listTemplates: () => ipcRenderer.invoke('project:templates') as Promise<ProjectTemplate[]>,
  removeProject: (id: string) => ipcRenderer.invoke('project:remove', id) as Promise<{ ok: boolean; error?: string }>,
  importProject: (dir: string) => ipcRenderer.invoke('project:import', dir) as Promise<ImportResult>,
  importPicker: () => ipcRenderer.invoke('project:importPicker') as Promise<string | null>,
  exportProject: (id: string) =>
    ipcRenderer.invoke('project:export', id) as Promise<ExportResult & { cancelled?: boolean }>,
  revealProject: (id: string) => ipcRenderer.invoke('project:reveal', id),
  openProject: (id: string) => ipcRenderer.invoke('project:open', id) as Promise<boolean>,
  getRecentEntries: () => ipcRenderer.invoke('project:recents') as Promise<RecentEntry[]>,

  // 文档（相对项目根）
  readDoc: (id: string, rel: string) => ipcRenderer.invoke('doc:read', id, rel) as Promise<string | null>,
  writeDoc: (id: string, rel: string, content: string) => ipcRenderer.invoke('doc:write', id, rel, content) as Promise<boolean>,
  // 渲染层保存动作取证（P1 F-20260917-10：fire-and-forget 旁路，不 await 等待结果）
  saveTrace: (id: string, rel: string, entry: SaveTraceEntry) => ipcRenderer.invoke('doc:saveTrace', id, rel, entry) as Promise<boolean>,
  deleteDoc: (id: string, rel: string) =>
    ipcRenderer.invoke('doc:delete', id, rel) as Promise<{ ok: boolean; error?: string }>,
  // 章节管理（§6.2）：重命名 / 删除（联动大纲副产物）/ 导出单章 md
  renameChapter: (id: string, rel: string, newTitle: string) =>
    ipcRenderer.invoke('chapter:rename', id, rel, newTitle) as Promise<{ ok: boolean; newRel?: string; error?: string }>,
  // 章节「切片」名修改：改正文约定头 + 大纲副产物 fm 同步 + 旧切片提案置 stale（引用面收口见 store.editChapterSlice）
  editChapterSlice: (id: string, rel: string, newSlice: string) =>
    ipcRenderer.invoke('chapter:editSlice', id, rel, newSlice) as Promise<
      { ok: boolean; oldSlice?: string; newSlice?: string; synced?: number; staled?: number; error?: string }
    >,
  deleteChapter: (id: string, rel: string) =>
    ipcRenderer.invoke('chapter:delete', id, rel) as Promise<{ ok: boolean; error?: string; cleaned?: number }>,
  exportChapter: (id: string, rel: string) =>
    ipcRenderer.invoke('chapter:export', id, rel) as Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>,
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
  listLines: (projectId: string) => ipcRenderer.invoke('lines:list', projectId) as Promise<LineInfo[]>,
  // 素材库域（类别树 / 新建类别 / 文件名+全文搜索）
  listLibraryCategories: (id: string) => ipcRenderer.invoke('library:categories', id) as Promise<LibraryCategory[]>,
  createLibraryCategory: (id: string, name: string) =>
    ipcRenderer.invoke('library:createCategory', id, name) as Promise<{ ok: boolean; error?: string }>,
  searchDocs: (id: string, relDir: string, query: string, opts?: { excludePrefix?: string[]; limit?: number }) =>
    ipcRenderer.invoke('docs:search', id, relDir, query, opts) as Promise<SearchHit[]>,
  recentLibraryDocs: (id: string, n?: number) => ipcRenderer.invoke('library:recentDocs', id, n) as Promise<RecentLibraryDoc[]>,
  // 正文版本历史（M3）：列表元信息 + 读单版内容
  listHistory: (id: string, rel: string) => ipcRenderer.invoke('history:list', id, rel) as Promise<HistorySnapshot[]>,
  readHistory: (id: string, rel: string, name: string) => ipcRenderer.invoke('history:read', id, rel, name) as Promise<string | null>,
  // 保存正文前置快检：单章「名单外出场」命中（本地规则·零模型；与审计抽屉「在场」同口径）
  checkChapterUnlisted: (id: string, chapterRel: string) =>
    ipcRenderer.invoke('presence:chapterUnlisted', id, chapterRel) as Promise<
      | { ok: true; items: UnlistedHit[] }
      | { ok: false; error: string }
    >,
  // 保存正文前置快检：单章「列入未出场」命中（达正文字数阈值才查；与审计抽屉「在场」同口径）
  checkChapterMissing: (id: string, chapterRel: string) =>
    ipcRenderer.invoke('presence:chapterMissing', id, chapterRel) as Promise<
      | { ok: true; items: MissingHit[] }
      | { ok: false; error: string }
    >,

  // 提案（S4）
  listProposals: (id: string) => ipcRenderer.invoke('proposal:list', id) as Promise<Proposal[]>,
  createProposals: (id: string, source: 'slice-sync' | 'agent-chat' | 'annotation-sync', chapter: string, slice: string, items: ProposalItem[], meta?: { annotations?: { file: string; rows: number[] }[]; note?: string }, metas?: { annotations?: { file: string; rows: number[] }[]; note?: string }[]) =>
    ipcRenderer.invoke('proposal:create', id, source, chapter, slice, items, meta, metas) as Promise<Proposal[]>,
  applyProposal: (id: string, pid: string) =>
    ipcRenderer.invoke('proposal:apply', id, pid) as Promise<{ ok: boolean; applied: string[]; errors: string[]; retryable?: boolean }>,
  rejectProposal: (id: string, pid: string) => ipcRenderer.invoke('proposal:reject', id, pid) as Promise<boolean>,
  discardProposal: (id: string, pid: string) => ipcRenderer.invoke('proposal:discard', id, pid) as Promise<boolean>,

  // 批注定时优化：扫描项目内 *_批注.csv → 生成修改提案（结果 note 供 toast）
  scanAnnotations: (id: string) =>
    ipcRenderer.invoke('annotations:scan', id) as Promise<{ found: number; generated: number; skipped: number; note: string }>,
  // 划词添加批注：追加到 <md 同名>_批注.csv（loc 尽力而行，before=选中原文）
  annotationAdd: (id: string, mdRel: string, entry: { loc: string; before: string; note: string }) =>
    ipcRenderer.invoke('annotations:add', id, mdRel, entry) as Promise<{ csvRel: string; row: number; ok: boolean }>,
  // 读某章批注（显示 UI 用）：返回定位后的行（loc/note/before；before=可在编辑器正文匹配的文段，定位不到为空）
  annotationList: (id: string, mdRel: string) =>
    ipcRenderer.invoke('annotations:list', id, mdRel) as Promise<{ row: number; loc: string; note: string; before: string }[]>,
  annotationRemove: (id: string, mdRel: string, row: number) =>
    ipcRenderer.invoke('annotations:remove', id, mdRel, row) as Promise<{ ok: boolean; remaining: number; note: string }>,

  // 文件系统事件（项目目录被外部改动时）
  onFsEvent: (cb: (evt: FsEvent) => void) => {
    const listener = (_e: unknown, evt: FsEvent) => cb(evt)
    ipcRenderer.on('fs:event', listener)
    return () => {
      ipcRenderer.removeListener('fs:event', listener)
    }
  },

  // 系统菜单自定义动作（主进程 menu.ts -> menu:action；渲染层 App.tsx 单点分发）
  onMenuAction: (cb: (evt: MenuActionEvent) => void) => {
    const listener = (_e: unknown, evt: MenuActionEvent) => cb(evt)
    ipcRenderer.on('menu:action', listener)
    return () => {
      ipcRenderer.removeListener('menu:action', listener)
    }
  },
  // 系统菜单启用态上报（渲染层 MenuBridge/DocEditor → 主进程 applyMenuState；fire-and-forget）
  reportMenuState: (state: MenuStateReport) => {
    ipcRenderer.send('menu:state', state)
  },

  // agent（harness 引擎；流式事件按 requestId 认领）
  agentSend: (input: { requestId: string; projectId: string; chapterRel: string | null; chapterTitle: string; prompt: string; quote?: string | null; history?: { role: 'user' | 'assistant'; content: string }[]; focus?: boolean }) =>
    ipcRenderer.invoke('agent:send', input) as Promise<{ ok: boolean }>,
  agentCancel: (requestId: string) => ipcRenderer.invoke('agent:cancel', requestId) as Promise<boolean>,
  agentSync: (projectId: string, chapterRel: string) =>
    ipcRenderer.invoke('agent:sync', projectId, chapterRel) as Promise<{ ok: boolean; items: ProposalItem[]; guard?: { issues: SyncIssue[] }; evidence?: SyncEvidence; error?: string }>,
  syncLogList: (projectId: string) => ipcRenderer.invoke('sync:log', projectId) as Promise<SyncLogEntry[]>,
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
  agentDirector: (projectId: string, chapterRel: string, requirement?: string, cancelToken?: string) =>
    ipcRenderer.invoke('agent:director', projectId, chapterRel, requirement, cancelToken) as Promise<
      | { ok: true; written: string; sheet: DirectorSheet }
      | { ok: false; error: string }
    >,
  agentDirectorCancel: (token: string) => ipcRenderer.invoke('agent:directorCancel', token) as Promise<boolean>,
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
