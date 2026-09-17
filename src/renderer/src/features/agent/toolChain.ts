/**
 * 工具链分组（智能层 2026-09-15）：
 * 把消息流中「相邻连续的 meta 工具卡」聚合成一条工具链，让多轮连续工具调用
 * （典型：zj_read_doc 的 offset 续读链——2026-09-14 落地后真模型会连续读同一文档）可一眼
 * 追溯「顺序 / 步数 / 读了哪些文档、续读了几次」。对照 Claude Code / Cursor / claude-agent-ui
 * 的共性：工具调用按同一 assistant turn 的顺序流呈现，不靠连线，靠「次序可见 + 卡片信息完备」；
 * 织卷此前缺轮内序号与续读语义，本节补上。
 *
 * 约定：
 * - 分组判据 = 数组相邻且 kind === 'meta'（中间隔了 assistant/user 文本或其他卡即拆组）；
 *   单卡不成组（保持既有视觉零回归）。
 * - 「续读」判据 = 链内更早的 zj_read_doc 已读过同一文档（args 忽略 " (offset=N)" 后缀后相同）。
 */

export interface MetaMsgLike {
  id: string
  kind?: string
  tool?: string
  toolArgs?: string
}

export type ToolRenderItem = { type: 'single'; id: string } | { type: 'chain'; ids: string[] }

/** 把消息流分组成渲染项：相邻 meta 聚链（≥2 张），其余单条。 */
export function groupToolMeta(msgs: readonly MetaMsgLike[]): ToolRenderItem[] {
  const items: ToolRenderItem[] = []
  let chain: string[] = []
  const flush = () => {
    if (chain.length === 1) items.push({ type: 'single', id: chain[0] })
    else if (chain.length > 1) items.push({ type: 'chain', ids: chain })
    chain = []
  }
  for (const m of msgs) {
    if (m.kind === 'meta') chain.push(m.id)
    else flush()
  }
  flush()
  return items
}

/** 从工具参数摘要里取文档路径（args 形如 `正文/x.md` 或 `正文/x.md (offset=6000)`）。 */
export function parseToolFile(args?: string): string | undefined {
  if (!args) return undefined
  const i = args.indexOf(' (offset=')
  const file = i >= 0 ? args.slice(0, i) : args
  return file.length ? file : undefined
}

/** 续读判据：链内更早的 zj_read_doc 已读过同一文档 → 本次为续读（offset 续读链）。 */
export function isContinuedRead(msgs: readonly MetaMsgLike[], idx: number): boolean {
  const cur = msgs[idx]
  if (!cur || cur.tool !== 'zj_read_doc') return false
  const file = parseToolFile(cur.toolArgs)
  if (!file) return false
  for (let i = 0; i < idx; i++) {
    const prev = msgs[i]
    if (prev.tool === 'zj_read_doc' && parseToolFile(prev.toolArgs) === file) return true
  }
  return false
}

/** 链组聚合摘要（智能层 2026-09-17）：折叠态组头只渲染首条会吞掉组内后续步骤的结果状态——
 * 同工具连续 N 步里第 K 步失败时组头仍是「绿勾+×N」，作者误以为全部成功（业界基线=聚合视图结果
 * 状态始终可见，GitHub Actions run 摘要 success/failure/canceled/neutral 永不折叠）。 */
export interface GroupAgg {
  /** 组内任一步失败（done 且 toolOk=false） */
  hasFailed: boolean
  /** 组内任一步被取消且无失败（失败优先语义） */
  hasCancelled: boolean
  /** 首个失败步的结果摘要（组头失败态展示用） */
  summary: string | undefined
  /** 组内全部已终态步骤耗时合计（ms）；无任何耗时数据时 undefined */
  elapsedMs: number | undefined
  /** 组内步数 */
  count: number
}

export interface GroupAggMsgLike extends MetaMsgLike {
  done?: boolean
  toolOk?: boolean
  cancelled?: boolean
  elapsedMs?: number
  content?: string
}

/** 失败步处置引导文案（体验层 2026-09-17）：失败工具卡「让 agent 处理」填入输入框的预写指令。
 * 业界基线（Claude Code / Codex 一手调研，见 04-体验层.md 迭代日志 2026-09-17 14:15 轮）：
 * 两个一线 agent 都**没有**「单步工具重试按钮」——工具错误回灌模型、由模型自理（Claude Code 对
 * malformed 还有内置自动重试次数）；用户级恢复=消息粒度（Codex backtrack 把旧 prompt 恢复到输入框）。
 * 织卷等价形态＝把「重试该步/换方式」指引填回输入框（可编辑、不代发），处置权交还作者。 */
export function failureFollowupPrompt(tool: string, summary?: string): string {
  const s = (summary ?? '').trim()
  const clipped = s.length > 60 ? s.slice(0, 60) + '…' : s
  return `上一步「${tool}」调用失败${clipped ? `：${clipped}` : ''}。请查看错误详情后重试该步，或换一种方式完成当前任务。`
}

/** 仅对 ≥2 步的链组生效（单卡/单组无聚合语义，保持既有视觉零回归）。 */
export function summarizeGroup(msgs: readonly GroupAggMsgLike[]): GroupAgg | undefined {
  if (msgs.length < 2) return undefined
  const failed = msgs.find((m) => m.done === true && m.toolOk === false)
  let sum = 0
  let any = false
  for (const m of msgs) {
    if (typeof m.elapsedMs === 'number') {
      sum += m.elapsedMs
      any = true
    }
  }
  return {
    hasFailed: !!failed,
    hasCancelled: msgs.some((m) => m.cancelled) && !failed,
    summary: failed?.content || undefined,
    elapsedMs: any ? Math.round(sum * 10) / 10 : undefined,
    count: msgs.length
  }
}
