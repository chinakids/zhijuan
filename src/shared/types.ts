// 织卷 · 共享数据模型
// 设计原则：本地优先，纯 JSON 落盘，一个项目一个目录，可放进 git。
// v0.2 起引入「设定时间线」：每条设定以按章排列的切片（SettingSlice）演进，
// 生成时永远取「到本章为止」的最新切片，从机制上避免长文后期啃书啃错。

/** 一个设定切片：某个设定在「第 atChapter 章起」有效的内容 */
export interface SettingSlice {
  atChapter: number // 从这一章起，本切片接管该设定
  content: string // 本章节阶段的设定正文
  changeLog?: string // 变化说明（为什么变成了这样）
  source: 'initial' | 'sweep' | 'manual' // 初始 / 随正文沉淀 / 手动
  confirmed: boolean // sweep 产生的最新要先确认才生效
}

/** 通用要素条目卡：一条规则 / 一个场景 / 一件道具 / 一条 lore */
export interface Element {
  id: string
  kind: 'rule' | 'scene' | 'prop' | 'lore' | 'other'
  name: string // 名称，召回主键（如「异能档位」「学校琴房」「专属玻璃杯」）
  tags: string[] // 召回依据
  slices: SettingSlice[] // 时间线：slices[0] 为初始设定，之后按 atChapter 升序
  active: boolean // 停用的条目不再进上下文
  createdAt: number
  updatedAt: number
}

/** 每章一份的章节审计：章节结束时的世界快照（设定本体走时间线，这里只记事件） */
export interface ChapterRecord {
  chapterNum: number
  summary: string // 80~150 字事件摘要
  characterStates: { charId: string; state: string }[] // 出场人物本章末状态
  resolved: string[] // 兑现的伏笔
  sown: string[] // 新埋的伏笔
  standingChanges: string[] // 打动世界观状态的永久性变化（提示语，实际落成切片）
}

/** 全局伏笔台账（跨章节） */
export interface Foreshadow {
  id: string
  desc: string
  sownChapter: number
  resolvedChapter?: number
  status: 'open' | 'resolved' | 'dropped'
}

/** 待确认的沉淀草稿（sweep 结果，主人接受后才进时间线） */
export interface SweepDraft {
  id: string
  targetType: 'element' | 'character'
  targetId: string
  targetName: string
  atChapter: number
  draftContent: string
  changeLog: string
  status: 'pending' | 'accepted' | 'edited' | 'rejected'
}

/** 世界观背景 */
export interface Worldview {
  name: string
  city: string // 城市 / 时代舞台
  era: string // 时代背景
  themes: string[] // 主题关键词
  rules: string[] // 世界观规则（前设 / 约束）
  background: string // 长文本背景设定
}

/** 人物档案项（自由 key-value：皮肤、体态、声音、胸部、三角区、外阴、玉足……） */
export interface CharacterField {
  key: string
  value: string
}

/** 人物设定 */
export interface Character {
  id: string
  name: string
  role: string // 男主 / 女主 / 配角 / 背景
  age: number
  isProtagonist: boolean // 是否主角（陈默式贯穿人物）
  tags: string[] // 标签（处子、御姐、白领、学生……）
  fields: CharacterField[] // 结构档案（九项身体档案等）
  background: string // 身世背景
  relation: string // 与主角的关系 / 定位
  firstAppear?: number // 首现章（可空，慢慢补）
  active: boolean // 停用的不再参与生成
  slices: SettingSlice[] // 时间线：外观/性格/关系的阶段性切片（当前字段 = 最后切片）
}

/** 曲线上的一个控制点 */
export interface CurvePoint {
  x: number // 0..100 章节进度百分比
  y: number // 0..100 强度百分比
  label?: string // 可选标记（如「她进门」「内射」）
}

/** 行为轴档位：强度落在 [min, 下一档 min) 区间时，用本档的可写动作要求 */
export interface AxisBand {
  min: number // 本档强度下限（含）；按 min 升序，须完整覆盖 0..100
  label: string
  demand: string // 该强度区间的可写动作要求（具体到动作、眼神、声音、身体反应）
}

/** 一根行为轴曲线：可自由命名，有自己可拖拽的曲线与可选的档位定义 */
export interface CurveAxis {
  id: string
  name: string // 轴名（自由填，如「她的主动权」「他的压迫感」「两人距离」）
  points: CurvePoint[] // 该轴的曲线控制点（可拖）
  bands?: AxisBand[] // 可选档位；缺省用通用三档（被动/拉锯/主导）
}

/** 一条曲线（情绪曲线或人物曲线） */
export interface SeriesCurve {
  id: string
  kind: 'emotion' | 'character'
  name: string // 情绪名（紧张、甜腻、肉欲）或 角色名
  color: string // 显示颜色
  axis?: string // 兼容旧字段：legacy 单轴（轴库 id 或名字）；新数据请用 axes
  axes?: CurveAxis[] // 行为轴曲线集合（人物曲线用；有它时 axis 被忽略）
  points: CurvePoint[]
}

/** 章节 · 情节点（曲线上的重要刻度，是给 AI 的结构提示） */
export interface PlotBeat {
  id: string
  at: number // 对应曲线进度位置 0..100
  label: string // 情节点名（如「破门而入」「内射」）
  note: string // 说明文字（该点的关键动作 / 视觉）
}

/** 曲线兑现检查（M2.4）：本章生成后把正文 + 本章曲线契约过一遍，标出没兑现的段落 */
export interface FulfillVerdict {
  id: string // 对应 FulfillChecklistItem 的 id（如 D3 / A-沈若汐·防线 / B-破门而入）
  result: 'met' | 'partial' | 'miss' | 'unknown' // 已兑现 / 部分 / 未兑现 / 模型未判定
  blocks: string // 证据位置（正文块号，逗号分隔；模型给不出可留空）
  note: string // 模型给的一句理由
}

/** 一次兑现检查的完整结果（挂在 Chapter.fulfill 上，可选，向后兼容） */
export interface FulfillReport {
  checkedAt: number
  total: number // 契约要求条目数
  met: number
  partial: number
  miss: number
  unknown: number
  verdicts: FulfillVerdict[] // 逐条判定（含未兑现的细节）
  raw: string // 模型原始输出（可回看排查）
}

/** 章节 */
export interface Chapter {
  id: string
  num: number // 章节序号
  title: string
  status: 'plan' | 'draft' | 'done'
  elements: string // 本章要素（主人给的原始要求）
  premise: string // 本章梗概
  curves: SeriesCurve[] // 情绪曲线 + 人物曲线集合
  beats: PlotBeat[] // 重要情节点
  content: string // 生成的正文
  acts?: string[] // M2.2 分幕生成的各幕正文字块（可选；旧数据缺省时以 content 为整幕）
  fulfill?: FulfillReport // M2.4 曲线兑现检查结果（可选；旧数据无此字段）
  updatedAt: number
}

/** 项目（对应一个小说作品） */
export interface Project {
  id: string
  name: string
  description: string
  worldview: Worldview
  characters: Character[]
  chapters: Chapter[]
  elements: Element[] // 设定库（时间线条目）
  records: ChapterRecord[] // 每章的审计记录
  foreshadows: Foreshadow[] // 伏笔台账
  sweepDrafts: SweepDraft[] // 沉淀草稿池
  updatedAt: number
}
