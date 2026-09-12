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

/** 导入已有目录的结果（copied=false 表示项目库中已有同名项目，未再复制） */
export interface ImportResult {
  ok: boolean
  summary?: ProjectSummary
  error?: string
  copied?: boolean
}

/** 项目模板（新建项目时的「初始内容」选项） */
export interface ProjectTemplate {
  id: string
  name: string
  builtin: boolean
}

/** 章节约定头（模块设计 §2.3，全文唯一半结构化约定；键为中文，与磁盘文件一致） */
export interface ChapterFrontMatter {
  章号?: number
  题名?: string
  切片?: string
  时间?: string
  涉及人物?: string[]
}

/** 时间切片清单条目（章头 front matter 的 切片 字段；正文为源，清单只是索引，见 main/slices.ts） */
export interface SliceEntry {
  name: string
  chapter: string
  time?: string
  chars?: string[]
  updatedAt: number
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

/** 可对接的模型厂商（模型适配接入层，见 src/main/agent/providers.ts） */
export type LlmProviderId = 'local' | 'deepseek' | 'glm' | 'openai' | 'claude' | 'gemini'

/** 某一家的覆盖配置（baseUrl/model 不填用厂商预设默认；apiKey 只存本机 settings） */
export interface LlmProviderCfg {
  apiKey?: string
  baseUrl?: string
  model?: string
}

/** 模型适配层设置：active = 当前服务商；providers = 各家的覆盖项 */
export interface LlmSettings {
  active: LlmProviderId
  providers: Partial<Record<LlmProviderId, LlmProviderCfg>>
}

/** 设置（存 app userData） */
export interface AppSettings {
  /** 工作区根目录（空则用 文档/织卷工作区）；相关文档与项目库都在其下 */
  workspace: string
  libraryRoot: string
  llm: LlmSettings
  theme: 'paper' | 'dark'
  collectionEnabled: boolean
  /** 批注定时优化（主人 2026-09-12 定：默认关；开启=打开项目 10s 后首扫 + 每 30 分钟自动扫描批注生成提案） */
  annotationsEnabled: boolean
  /** 常用 agent 工具开关（harness 引擎内） */
  agentTools?: { todo?: boolean; askUser?: boolean }
  /** agent 能力开关（模块 J / E3）：缺省 = 全开；值为 false 即关闭该能力 */
  capabilities?: Record<string, boolean>
}

export const DEFAULT_SETTINGS: AppSettings = {
  workspace: '', // 为空则用 文档/织卷工作区
  libraryRoot: '', // 为空则用 <工作区>/项目库
  llm: { active: 'local', providers: {} },
  theme: 'paper',
  collectionEnabled: true,
  annotationsEnabled: false,
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

/** 正文修改条目（agent 用 zj_edit_doc 生成，UI 以 IDE 前/>后对比呈现，采纳才写入） */
export interface EditItem {
  id: string
  /** 定位原文（须在文件中唯一出现） */
  find: string
  replace: string
  reason?: string
  /** 展示用：命中原文的上下文摘要（工具返回时带上，含定位辅助） */
  before?: string
  after?: string
}

/** agent 流事件（主进程 → 渲染层，按 requestId 认领） */
export interface AgentEvent {
  requestId: string
  type: 'delta' | 'meta' | 'meta-done' | 'think' | 'edit' | 'final' | 'done' | 'aborted' | 'error' | 'todo' | 'ask'
  text?: string
  /** type = meta-done 时工具是否成功（缺省视为成功；false 渲染失败态） */
  ok?: boolean
  /** type = meta 时的工具名 */
  tool?: string
  /** 工具开始时的参数字符串（如 zj_read_doc 的 file，用于 UI 展示“读了哪个文档”） */
  args?: string
  message?: string
  /** type = todo 时的全量清单 */
  items?: TodoItem[]
  /** type = ask 时的提问组 */
  questions?: AskQuestion[]
  /** type = ask 时的提问批次 id（提交答案时回传） */
  batch?: string
  /** type = edit 时的目标文件（相对项目根） */
  file?: string
  /** type = edit 时的修改条目 */
  edits?: EditItem[]
}

/** 文件系统事件（watcher 广播给渲染层） */
export interface FsEvent {
  projectId: string
  kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
}

/** 素材库一级类别（目录=类别；count 为该目录下素材数） */
export interface LibraryCategory {
  name: string
  count: number
}

/** 素材库/任意目录全文搜索命中（file 相对项目根） */
export interface SearchHit {
  /** 相对项目根的文件路径（readDoc/edit 直接可用） */
  file: string
  /** 去扩展名的文件名 */
  name: string
  mtime: number
  /** 命中方式：文件名命中 / 正文命中 */
  field: 'name' | 'content'
  /** 命中片段（文件名命中=文件名；正文命中=首处命中行上下文，截断） */
  snippet: string
}

/** 最近素材条目（按 mtime 最近修改；file 相对项目根） */
export interface RecentLibraryDoc {
  file: string
  name: string
  mtime: number
}

/** 正文版本历史的单条快照（列表元信息；内容由 history:read 单独取） */
export interface HistorySnapshot {
  /** 版本文件名：yyyyMMdd-HHmmss-SSS[(-N)].md */
  name: string
  mtimeMs: number
  size: number
}

/** 提案（模块设计 §10；S4 用，先定义好结构） */
export interface ProposalItem {
  target: string
  anchor: string
  kind: 'upsert-section' | 'append' | 'replace-text'
  before: string
  after: string
  reason: string
}
/** 批注同步来源引用（proposal.meta.annotations）：接受/拒绝后按行删除对应 csv 条目 */
export interface AnnotationRef {
  /** 批注 csv 相对路径（如 正文/第01章_雾港_批注.csv） */
  file: string
  /** 已生成提案的 csv 行号（1-based） */
  rows: number[]
}
export interface Proposal {
  id: string
  source: 'slice-sync' | 'agent-chat' | 'annotation-sync'
  chapter: string
  slice: string
  status: 'pending' | 'accepted' | 'rejected' | 'stale'
  createdAt: number
  items: ProposalItem[]
  meta?: { annotations?: AnnotationRef[]; note?: string }
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

/** 全卷检查（agent-first）：一致性巡查 / 冷读报告 / 多视角审视；presence=本地规则「人物在场核查」（零模型）；order=本地规则「切片时序核查」（零模型）；unused=本地规则「人物档案腐坏核查」（零模型） */
export type AuditKind = 'consistency' | 'review' | 'perspectives' | 'presence' | 'order' | 'unused'
export interface AuditItem {
  severity: 'high' | 'medium' | 'low'
  type: string
  where: string
  what: string
  suggest: string
  /** 多视角审视：这条是哪一位立场读者找到的（角色粉 / 设定党 / 节奏读者）；其他检查不带 */
  viewer?: string
  /** 建议写进的目标设定文件（人物/… 或 世界观/…）；给得出才带，用于转提案 */
  target?: string
  /** 关联档案路径（仅指路：如别名的登记处 人物/<名>.md）；不做转提案目标 */
  refFile?: string
}
export interface AuditResult {
  summary: string
  items: AuditItem[]
}

/** 单章「名单外出场」快检（保存正文时前置提示）：正文出现档案人物本名/登记别名、但本章约定头「涉及人物」未列 */
export interface UnlistedHit {
  /** 人物档案题名（本名） */
  name: string
  /** 命中的登记别名（正文只出现别名、未出现本名时给出） */
  alias?: string
}

/** 单章「列入未出场」快检（保存正文时前置提示）：约定头「涉及人物」列了、但本章正文未出现本名或登记别名 */
export interface MissingHit {
  /** 人物档案题名（本名） */
  name: string
  /** 该人物档案登记的别名（正文与别名均未出现时给出，供判断是否用了未登记别称） */
  aliases?: string[]
}

/** 本章级检查（agent-first 小环）：每章短巡查 / 分层修订 */
export type ChapterCheckKind = 'chapter' | 'revision'
/** 修订层：故事 / 场景 / 词句（沿写作线的打磨顺序） */
export type RevisionLayer = 'story' | 'scene' | 'prose'
export interface ChapterCheckItem {
  severity: 'high' | 'medium' | 'low'
  type: string
  /** 分层修订时给出所属层；短巡查不带 */
  layer?: RevisionLayer
  where: string
  what: string
  suggest: string
  /** 本条建议涉及的设定文件（人物/… 或 世界观/…）；给得出才带，用于转提案 */
  target?: string
}
export interface ChapterCheckResult {
  summary: string
  items: ChapterCheckItem[]
}

/** 大纲区：一张章卡对应一章正文（agent 从正文回建） */
export interface OutlineCard {
  /** 对应正文文件，如 正文/第01章_雾港.md */
  file: string
  no?: number
  title: string
  slice: string
  /** 一句话定位：这一章在全书里干什么 */
  oneLine: string
  /** 关键事件（动词短语） */
  beats: string[]
  /** 主要人物在本章的状态变化 */
  charProgress: string
  /** 本章新埋的钩子 / 应该回应的旧钩子 */
  hooks: string[]
  wordCount: number
}

/** 素材→设定升格判定 */
export type TriageVerdict = 'promote' | 'reference' | 'skip'
export interface TriageItem {
  file: string
  name: string
  /** promote=可直接入档为设定；reference=可借鉴暂不入档；skip=用不上 */
  verdict: TriageVerdict
  /** 素材在素材库里的归属类别（桥段 / 人物原型 / 环境…） */
  category: string
  /** 素材一句话说明 */
  what: string
  suggestion: string
  /** promote 时建议入档的设定文件（人物/… 或 世界观/…，须为已存在文件） */
  target?: string
}
export interface TriageResult {
  summary: string
  items: TriageItem[]
}

/** 章节导演（V1 导演引擎回接）：一章一板，先设定后成文的引擎核心 */
export type DirectorTask = '推进' | '白热化' | '拉锯' | '低谷'
export type DirectorAxisLevel = '被压' | '试探' | '放开'
export interface DirectorSheet {
  /** 本章戏剧任务一句话：这一章在全书里干什么、要把人物推到什么位置 */
  premise: string
  /** 情绪弧分段（最多 5 段）：每段的戏剧任务与要走到哪 */
  arcs: { task: DirectorTask; goal: string }[]
  /** 波峰：在哪一段、建议一个具体事件 */
  climax: { at: number; idea: string }
  /** 涉及人物的行为轴要求（人物必须真实存在档案） */
  axes: { character: string; line: string; level: DirectorAxisLevel }[]
  /** 写作红线（最多 5 条）：不许破的线 */
  redlines: string[]
  /** 本章应兑现的旧钩子 / 可新埋的钩子（最多 3 条） */
  hooks: string[]
}

/** 导演兑现检查（V1 兑现检查回接）：动笔后对照导演板核对本章是否兑现了导演承诺 */
export interface DirectorCheckItem {
  /** 导演板里被核对的原文（段落戏剧任务 / 行为轴 / 红线 / 钩子各一句） */
  ref: string
  /** 按类别取对应状态，见各类 Status 类型 */
  status: string
  /** 一句依据：对照正文哪里怎么判的 */
  note: string
}
export interface DirectorCheckResult {
  /** 一段话：本章整体兑现得如何，最需要回头补的那一处 */
  summary: string
  /** 情绪弧分段核对：done 兑现 / partial 部分兑现 / missed 没兑现（最多对应 arcs 段数） */
  arcs: DirectorCheckItem[]
  /** 行为轴核对：aligned 守位 / drifted 漂移 / absent 正文没写到（人物只留本章涉事清单内） */
  axes: DirectorCheckItem[]
  /** 红线核对：kept 守住 / broken 被破 */
  redlines: DirectorCheckItem[]
  /** 钩子核对：paid 已还 / open 仍悬着 / new 新埋 */
  hooks: DirectorCheckItem[]
}
