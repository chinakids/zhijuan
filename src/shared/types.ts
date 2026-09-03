// ===== 织卷 V2 · 共享类型（模块设计 §2/§10 对应） =====

/** 项目元数据：来自 <项目>/project.md 的 front matter */
export interface ProjectMeta {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
}

/** 首页卡片用的统计 */
export interface ProjectStats {
  chapters: number
  characters: number
  worldviewFiles: number
  materials: number
}

export interface ProjectSummary extends ProjectMeta {
  stats: ProjectStats
  lastChapter?: string
}

/** 章节约定头（模块设计 §2.3，全文唯一半结构化约定；键为中文，与磁盘文件一致） */
export interface ChapterFrontMatter {
  章号?: number
  题名?: string
  切片?: string
  时间?: string
  涉及人物?: string[]
}

/** 目录里扫描到的章节条目 */
export interface ChapterEntry {
  file: string // 相对项目根，如 正文/第01章_夏夜.md
  name: string
  fm: ChapterFrontMatter | null
  wordCount: number
  mtime: number
  hasPendingProposal: boolean
}

/** 设置（存 app userData） */
export interface AppSettings {
  /** 工作区根目录（空则用 文档/织卷工作区）；相关文档与项目库都在其下 */
  workspace: string
  libraryRoot: string
  llm: { baseUrl: string; model: string; apiKey: string }
  theme: 'paper' | 'dark'
  collectionEnabled: boolean
  /** agent 引擎：harness = dsh 写作引擎（有工具）；legacy = 直连 LLM 对话 */
  agentEngine: 'harness' | 'legacy'
  /** 常用 agent 工具开关（harness 引擎内） */
  agentTools?: { todo?: boolean; askUser?: boolean }
}

export const DEFAULT_SETTINGS: AppSettings = {
  workspace: '', // 为空则用 文档/织卷工作区
  libraryRoot: '', // 为空则用 <工作区>/项目库
  llm: { baseUrl: 'http://127.0.0.1:8888', model: 'deepseek-v4-flash-0731', apiKey: '' },
  theme: 'paper',
  collectionEnabled: true,
  agentEngine: 'harness',
  agentTools: { todo: true, askUser: true }
}

/** todo 清单项（模型通过 todo_write 维护的全量列表） */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** ask_user_question 的一次提问 */
export interface AskQuestion {
  id: string
  question: string
  header?: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
}

/** 用户对一次提问的回答 */
export interface AskAnswer {
  id: string
  selected: string[]
  custom?: string
}

/** agent 流事件（主进程 → 渲染层，按 requestId 认领） */
export interface AgentEvent {
  requestId: string
  type: 'delta' | 'meta' | 'meta-done' | 'final' | 'done' | 'aborted' | 'error' | 'todo' | 'ask'
  text?: string
  tool?: string
  message?: string
  /** type = todo 时的全量清单 */
  items?: TodoItem[]
  /** type = ask 时的提问组 */
  questions?: AskQuestion[]
  /** type = ask 时的提问批次 id（提交答案时回传） */
  batch?: string
}

/** 文件系统事件（watcher 广播给渲染层） */
export interface FsEvent {
  projectId: string
  kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
}

/** 提案（模块设计 §10；S4 用，先定义好结构） */
export interface ProposalItem {
  target: string
  anchor: string
  kind: 'upsert-section' | 'append'
  before: string
  after: string
  reason: string
}
export interface Proposal {
  id: string
  source: 'slice-sync' | 'agent-chat'
  chapter: string
  slice: string
  status: 'pending' | 'accepted' | 'rejected' | 'stale'
  createdAt: number
  items: ProposalItem[]
}

/** 采集任务（模块设计 §11；S5 用） */
export interface CollectionTask {
  id: string
  status: 'pending' | 'running' | 'done' | 'failed'
  demand: string
  keywords: string[]
  sourceHint: string
  category: string
  createdAt: number
  resultFile?: string
  summary?: string
  error?: string
}
