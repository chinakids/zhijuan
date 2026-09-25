// ===== 织卷 V2 · 共享类型（模块设计 §2/§10 对应） =====
import { AGENT_PANEL_DEFAULT_WIDTH } from './uiPrefs'

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

/** 导出项目（复制项目目录到用户选择的位置）的结果 */
export interface ExportResult {
  ok: boolean
  dest?: string
  error?: string
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
  时间线?: string
  涉及人物?: string[]
}

/** 时间切片清单条目（章头 front matter 的 切片 字段；正文为源，清单只是索引，见 main/slices.ts） */
export interface SliceEntry {
  name: string
  chapter: string
  /** 所属时间线（章头「时间线」字段；缺省=「主线」；权威口径 shared/line.ts，多时间线叙事 2026-09-16） */
  line: string
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

/** 设置页 pane 键（体验层 2026-09-18；与 Settings.tsx SECTIONS 的 key 一一对应，HIG Settings 分区导航） */
export type SettingsPaneKey = 'workspace' | 'engine' | 'look' | 'about'

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
  /** 焦点模式（体验层 2026-09-17：当前段保持、其余段落淡化；默认关，设置页开关） */
  focusModeEnabled: boolean
  /** 打字机滚动（体验层 2026-09-17：输入时正文自动滚动，光标行保持屏幕中线附近；默认关，设置页开关） */
  typewriterEnabled: boolean
  /** Agent 面板宽度（px，模块设计 §十二「面板宽度记忆」；拖拽/方向键调整，越界钳制见 shared/uiPrefs） */
  agentPanelWidth: number
  /** 各页导航列折叠态（体验层 2026-09-18；macOS 惯例=记住侧栏状态跨重启，Pages/TextEdit 先例）。
   * 五键对应五个导航页：novel=正文创作章列 / characters=人物档案列 / worldview=世界观列 / outline=大纲章卡列 / library=素材库类别树。
   * 人物与世界观共用 DocSection 组件但按键分开——两页折叠态相互独立（与旧会话内行为一致）。
   * setSettings 是浅合并——改任一键必须传全量对象（先例 agentPanelWidth 平铺键；foldedCols 聚合为一键避免四处平铺）。 */
  foldedCols: { novel: boolean; characters: boolean; worldview: boolean; outline: boolean; library: boolean }
  /** 设置页当前 pane（体验层 2026-09-18；HIG Settings「Restore the most recently viewed pane」——macOS 系统设置打开回到上次分区）。
   * 默认 workspace；在 Settings.tsx 侧栏选择时即时写盘。 */
  settingsPane: SettingsPaneKey
  /** 常用 agent 工具开关（harness 引擎内） */
  agentTools?: { todo?: boolean; askUser?: boolean }
  /** agent 能力开关（模块 J / E3）：缺省 = 全开；值为 false 即关闭该能力 */
  capabilities?: Record<string, boolean>
  /** 自定义用词词表（2026-09-21 智能层，候选「用词词表二期」；缺省=undefined=仅内置词表）。
   *  与 BUILTIN_OVERUSE 合并扫全卷正文（shared/wordfreq.normalizeOveruseDict 清洗），只报频次不判对错；
   *  设置页增删改/导入导出=体验层/平台层接线（本轮智能层只完成字段+透传+口径）。 */
  overuseDict?: string[]
  /** 写作习惯学习（F-20260917-06 / D-L-4：默认关；开启=打开项目检查距上次分析≥7 天时后台生成 skill 草稿+报告；
   *  批注定时优化开关先例口径——新增自动化行为一律默认关，设置页「外观与数据」开关 UI=体验层/平台层接线（增量 4c））。
   *  分析执行=main/writingInsights.ts（增量 4b，智能层），纯函数/template=shared/writingInsights.ts（增量 4a）。 */
  writingInsightsEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  workspace: '', // 为空则用 文档/织卷工作区
  libraryRoot: '', // 为空则用 <工作区>/项目库
  llm: { active: 'local', providers: {} },
  theme: 'paper',
  collectionEnabled: true,
  annotationsEnabled: false,
  focusModeEnabled: false,
  typewriterEnabled: false,
  agentPanelWidth: AGENT_PANEL_DEFAULT_WIDTH,
  foldedCols: { novel: false, characters: false, worldview: false, outline: false, library: false },
  settingsPane: 'workspace',
  agentTools: { todo: true, askUser: true },
  writingInsightsEnabled: false
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
  type: 'delta' | 'meta' | 'meta-done' | 'think' | 'edit' | 'final' | 'truncated' | 'done' | 'aborted' | 'error' | 'todo' | 'ask'
  text?: string
  /** type = meta-done 时工具是否成功（缺省视为成功；false 渲染失败态） */
  ok?: boolean
  /** type = meta 时的工具名 */
  tool?: string
  /** 工具开始时的参数字符串（如 zj_read_doc 的 file，用于 UI 展示“读了哪个文档”） */
  args?: string
  /** type = meta：完整参数 JSON（工具卡「细节展开」用；超长已截断） */
  argsJson?: string
  /** type = meta-done：完整结果正文（展开可查；失败时含完整报错；超长已截断） */
  result?: string
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
  /** 接受时一致性校验基线（2026-09-20 候选 3）：切片同步生成端由代码提取的「该小节生成时刻
   * 完整内容」（trim 归一化）。undefined=无校验基线（旧档 / agent-chat 转提案等非 slice-sync 路径）
   * → apply 维持既有行为；null=生成时刻该节不存在；string=生成时刻节内容（含 ''=空节）。 */
  beforeExact?: string | null
}

/** 切片同步产物守卫（候选 2e：target 存在性防线）的单条处置记录 */
export interface SyncIssue {
  /** 模型产出的原 target（含修正前形态） */
  target: string
  /** corrected=已自动纠正为近名档案；dropped=已丢弃（该条不进提案） */
  action: 'corrected' | 'dropped'
  reason: string
  /** 未建档型 dropped（涉及人物已列但 人物/<名>.md 不存在）——UI 可提供「快速建档」动作（2026-09-15 创作层） */
  unfiled?: boolean
}

/** 切片同步「比对基准」证据（2026-09-14 21:45 创作层：无设定变化时的可信呈现） */
export interface SyncEvidence {
  /** 约定头「切片」名（本次装配/归一的基准名）；空=作者未设，属须知信号 */
  slice: string
  /** 约定头「涉及人物」数 */
  castCount: number
  /** 本次可比对的现有人物档案数（人物/ 下 .md），比对基数 */
  knownFiles: number
  /** 约定头涉及但未建档的人数（比对盲区，作者需知情） */
  unarchived: number
  /** 正文为空被本地短路：未比对、未调模型、零提案（2026-09-20 创作层；证据小字改示「正文为空，未比对」） */
  bodyEmpty?: boolean
}

/** 切片同步历史日志单条（2026-09-16 创作层：.zhijuan/sync-log.jsonl 着一行一条，作者可回溯） */
export interface SyncLogEntry {
  /** 时间戳（ms） */
  time: number
  /** 被同步章节相对路径 */
  chapter: string
  /** 约定头「切片」名（空=未设） */
  slice: string
  /** 约定头「涉及人物」数 */
  castCount: number
  /** 可比对人档基数 */
  fileCount: number
  /** 本次产出提案数（守卫后保留） */
  itemCount: number
  /** 守卫拦截/纠正条数 */
  guardCount: number
  /** 同步是否成功 */
  ok: boolean
  /** 同步时刻章节正文本体长度（剥约定头后；0=正文为空——P1 F-20260917-10 取证字段：清空写盘后同步照跑的形态在日志一眼可辨） */
  bodyLen?: number
  /** ok=false 时的错误摘要（截断 120 字） */
  error?: string
}
/** 渲染层保存动作取证单条（2026-09-19 创作层，P1 F-20260917-10 残余：写盘方已钉死但「保存时编辑器为何为空」渲染层无日志）。
 * 与主进程 write-log（写盘侧事实：长度/内容头）互补：本条=保存动作侧状态（mdLen/status/epoch/confirmEmpty/action）。
 * 落盘 `.zhijuan/save-trace.jsonl`（main/saveTrace.ts），仅取证不改保存行为。 */
export interface SaveTraceEntry {
  /** 时间戳（ms） */
  time: number
  /** 保存时刻编辑器正文长度（getMarkdown；0=空——P1 现场形态；aborted 时 -1=未取得） */
  mdLen: number
  /** 保存时刻 DocStatus（idle/dirty/saving/saved/external/error） */
  status: string
  /** 编辑器重建代次（epoch；换章/静默重载竞态判别） */
  epoch: number
  /** 空写两步确认态（P1 防线：是否已确认清空） */
  confirmEmpty: boolean
  /** 空 md 时磁盘正文本体长度（>=0；非空 md 未读盘=-1） */
  diskBodyLen: number
  /** 保存动作分类：write=正常写盘 / blocked=空写被拦 / allow-empty=确认后空写放行 / write-empty=磁盘亦空的空写 / aborted=编辑器未就绪（Prose create 窗口） */
  action: 'write' | 'blocked' | 'allow-empty' | 'write-empty' | 'aborted'
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

/** 全卷检查（agent-first）：一致性巡查 / 冷读报告 / 多视角审视；presence=本地规则「人物在场核查」（零模型）；order=本地规则「切片时序核查」（零模型）；unused=本地规则「人物档案腐坏核查」（零模型）；actgaps=本地规则「正文缺段核查」（零模型）；sliceord=本地规则「档案切片核查」（零模型）；nameform=本地规则「称谓发现核查」（零模型）；mixform=本地规则「称谓混用核查」（零模型）；overuse=本地规则「用词重复核查」（零模型，2026-09-20 智能层） */
export type AuditKind = 'consistency' | 'review' | 'perspectives' | 'presence' | 'order' | 'unused' | 'actgaps' | 'sliceord' | 'nameform' | 'mixform' | 'overuse'
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
  /** 称谓类（nameform/mixform）：本条建议拟登记的别名（转提案专用，构造可执行变更） */
  aliasCandidates?: string[]
  /** 已构造好的可执行变更提案（称谓类：把别名并入约定头「别名: [...]」）；抽屉据此建提案，无则回退旧「建议文本追加」 */
  proposal?: ProposalItem
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
  /** 线名（章头「时间线」归一后；不写/主线=undefined；与建章向导 0181b8d「空或主线不写字段」同口径，章卡 fm 非主线才写「时间线」） */
  line?: string
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

/** 结构点巡检：一条线的一个结构点（模型直判章卡自然语义；role 为自由文本，不强约束枚举） */
export interface StructureLinePoint {
  /** 章节（章号或题名，取自章卡） */
  chapter: string
  /** 结构角色：开局/转折/中点/高潮/收束 等（参考 25/50/75% 比例线的描述性判定） */
  role: string
  /** 一句自然话：为什么判它是这个结构点 */
  note: string
}
export interface StructureLineReport {
  /** 线名（章头「时间线」归一后；不写=主线） */
  name: string
  /** 该线结构点分布（≤8 条） */
  points: StructureLinePoint[]
  /** 可选：该线节奏/分布的一句话观察 */
  pacingNote?: string
}
export interface StructureEnd {
  /** 早线名 */
  line: string
  /** settled=晚线高潮前已收束 / loose=仍悬着（Weiland 双线法则⑥） */
  status: 'settled' | 'loose'
  /** 两端证据：钩子/关键事件收束 + 导演板波峰位置 */
  evidence: string
  /** 一句话建议/说明 */
  note?: string
}
export interface StructureCheckResult {
  summary: string
  /** 各线结构点分布 */
  lines: StructureLineReport[]
  /** 早线收束检查（≤4 条） */
  ends: StructureEnd[]
  /** 其他发现（≤8 条） */
  notes?: string[]
}

/** 系统菜单自定义动作 id（docs/系统菜单-设计口径.md 首期 10 个自定义通道；主进程 menu.ts + 渲染层 App.tsx 分发共用） */
export type MenuActionId =
  | 'settings'
  | 'newProject'
  | 'newChapter'
  | 'save'
  | 'findOpen'
  | 'findUseSel'
  | 'findNext'
  | 'findPrev'
  | 'shortcutHelp'
  | 'openWorkspaceDocs'

/** 菜单自定义动作事件载荷（preload onMenuAction 回调参数） */
export interface MenuActionEvent {
  id: MenuActionId
}

/** 菜单启用态路由分类（渲染层 routeKindOfHash 判定后上报；主进程 applyMenuState 使用） */
export type MenuRouteKind = 'home' | 'project' | 'other'

/** 渲染层→主进程 菜单启用态上报（fire-and-forget send；主进程按口径 §二「启用条件」更新原生菜单项 enabled） */
export interface MenuStateReport {
  route: MenuRouteKind
  /** 文档编辑器（DocEditor）是否挂载——保存/查找组使能依据（正文与分幕草稿同构，挂载即可用） */
  editor: boolean
}
