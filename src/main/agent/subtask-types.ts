// 子任务定义的类型（单独文件，避免 subtask.ts 引用了才定义的循环）。

export interface SubtaskCtx {
  projectId: string
  args?: Record<string, unknown>
  seq: number
}

export type SubtaskOutcome<T> =
  | { ok: true; result: T; /** 诊断：最后一次驱动仍被判定「空/无效」时，附上模型原始回复（正常路径不带，UI 可忽略） */ lastRaw?: string }
  | { ok: false; error: string }

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
  /** 单次会话超时（默认 7 分钟）；可为函数按 ctx（如 args.kind）区分（与 maxTokens 同构） */
  maxMs?: number | ((ctx: SubtaskCtx) => number | undefined)
  /** 会话输出预算（2026-09-19 智能层）：覆盖 SDK 全局 maxTokens（12288）——dsh 会话懒创建于首次
   * prompt，此值随 prompt 携带（vendored 补丁 patch-server-maxtokens 在 server 侧应用）。
   * 可为函数：按 ctx（如 args.kind）区分；返回 undefined = 用全局档。 */
  maxTokens?: number | ((ctx: SubtaskCtx) => number | undefined)
  /** 会话思考档位（2026-09-20 智能层）：'off'|'low'|'high'|'max'——随 prompt 携带（vendored 补丁
   * patch-server-reasoning 在 server 侧经 createSession 安装模型选择）；可为函数按 ctx 区分。
   * 返回 undefined = 模型默认档（不传参，零行为变化）。依据：21:00 轮实测同场景 revision
   * low 档 10.7× 提速/质量等价（47.95s vs 511.96s）。 */
  reasoningEffort?: string | ((ctx: SubtaskCtx) => string | undefined)
}
