/**
 * 每文档滚动位置·会话内记忆（2026-09-16 体验层）
 *
 * 服务创作问题：作者在多章之间往返核对设定/伏笔时，切章会导致编辑器整棵重建
 * （Novel `epoch` + `key` 重建，防脏状态串文件），滚动位置每次回到顶部——
 * 长文（≥3k 字）里要手动重新定位，心流被打断。平台惯例＝会话内保持每文档
 * 滚动位置（VS Code 源码编辑器即此行为；其 Markdown 编辑器丢位置被用户列为
 * Bug：vscode#329625）。Apple HIG Scroll views「In some cases, scroll
 * automatically to help people find their place」同理位。
 *
 * 口径：模块级内存 Map，按 `projectId:rel` 记 scrollTop。**不落盘、不跨会话**
 * （跨会话恢复属另一议题，本轮范围克制）；LRU 上限 64 防长会话泄漏；
 * 恢复即消费（take），再次切走会重新保存，不存在基线漂移。
 */
const MAX = 64

const mem = new Map<string, number>()

export function saveScroll(key: string, top: number): void {
  if (mem.has(key)) mem.delete(key)
  mem.set(key, top)
  while (mem.size > MAX) {
    const k = mem.keys().next().value
    if (k === undefined) break
    mem.delete(k)
  }
}

/** 读取并消费（删除）。恢复失败/无记忆返回 undefined；再次切走会重新保存。 */
export function takeScroll(key: string): number | undefined {
  const v = mem.get(key)
  mem.delete(key)
  return v
}

/** 无头冒烟/诊断可观测性（只读快照） */
export function scrollMemorySnapshot(): Array<[string, number]> {
  return [...mem.entries()]
}
