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
