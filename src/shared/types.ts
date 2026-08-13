// 织卷 · 共享数据模型
// 设计原则：本地优先，纯 JSON 落盘，一个项目一个目录，可放进 git。

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
}

/** 曲线上的一个控制点 */
export interface CurvePoint {
  x: number // 0..100 章节进度百分比
  y: number // 0..100 强度百分比
  label?: string // 可选标记（如「她进门」「内射」）
}

/** 一条曲线（情绪曲线或人物曲线） */
export interface SeriesCurve {
  id: string
  kind: 'emotion' | 'character'
  name: string // 情绪名（紧张、甜腻、肉欲）或 角色名
  color: string // 显示颜色
  points: CurvePoint[]
}

/** 章节 · 情节点（曲线上的重要刻度，是给 AI 的结构提示） */
export interface PlotBeat {
  id: string
  at: number // 对应曲线进度位置 0..100
  label: string // 情节点名（如「破门而入」「内射」）
  note: string // 说明文字（该点的关键动作 / 视觉）
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
  updatedAt: number
}
