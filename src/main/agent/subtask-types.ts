// 子任务定义的类型（单独文件，避免 subtask.ts 引用了才定义的循环）。

export interface SubtaskCtx {
  projectId: string
  args?: Record<string, unknown>
  seq: number
}

export type SubtaskOutcome<T> = { ok: true; result: T } | { ok: false; error: string }

export interface SubtaskRetry<T> {
  /** 当 check 命中（结果似乎无效）时，用强化提示再跑一次 */
  check: (r: T) => boolean
  /** 追加在提示末尾的再要求 */
  prompt: string
}

export interface SubtaskDef<T> {
  /** 能力 id（注册表键，也用作 session 前缀） */
  id: string
  /** 设置页展示名 */
  title: string
  /** 一句说明 */
  description?: string
  /** session 前缀（默认用 id） */
  sidPrefix?: string
  /** 组装 prompt（材料包可在此判定“材料不足”并抛错） */
  buildParts: (ctx: SubtaskCtx) => string[] | Promise<string[]>
  /** 从驱动结果里解析出结构化数据（字段清洗规则都在这里） */
  parse: (text: string, ctx: SubtaskCtx) => T
  /** 可选的空结果重试（模型跑偏时强令再出一遍 JSON） */
  retry?: SubtaskRetry<T>
  /** 可选的结果后处理（校验 target、注数据等） */
  postprocess?: (result: T, ctx: SubtaskCtx) => T
  /** 单次会话超时（默认 7 分钟） */
  maxMs?: number
}
