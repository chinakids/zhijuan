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
  libraryRoot: string
  llm: { baseUrl: string; model: string; apiKey: string }
  theme: 'paper' | 'dark'
  collectionEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  libraryRoot: '', // 为空则用 文档/织卷项目库
  llm: { baseUrl: 'http://127.0.0.1:8888', model: 'deepseek-v4-flash-0731', apiKey: '' },
  theme: 'paper',
  collectionEnabled: true
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
