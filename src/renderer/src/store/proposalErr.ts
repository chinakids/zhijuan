// 提案级失败红字（errMap）纯逻辑——store 与单测共用（创作层 2026-09-17）。
// 语义：失败红字挂 store 层（跨抽屉开合/跨页保留，IO 失败保持 pending 后失败卡是「可恢复资源」，
// 作者关抽屉重开要知道「这条为什么还在待确认」）；成功/拒绝/过期/提案从列表消失时清除。
export function setErrInto(
  map: Record<string, string>,
  id: string,
  msg: string
): Record<string, string> {
  if (!msg) {
    if (!(id in map)) return map
    const n = { ...map }
    delete n[id]
    return n
  }
  return { ...map, [id]: msg }
}

export function pruneErrMap(
  map: Record<string, string>,
  ids: Set<string>
): Record<string, string> {
  const hasStale = Object.keys(map).some((k) => !ids.has(k))
  if (!hasStale) return map
  return Object.fromEntries(Object.entries(map).filter(([k]) => ids.has(k)))
}

/** 提案列表拉取失败 → 展示文案（2026-10-27 可见性 P1：失败不再静默成「没有提案」）。
 * 纯函数（tsconfig.node 白名单）：store 与单测共用，避免在组件里各写一套取 message 的兜底。 */
export function refreshErrMsg(e: unknown): string {
  let msg = ''
  if (e instanceof Error) msg = e.message
  else if (typeof e === 'string') msg = e
  else if (e === null || e === undefined) msg = ''
  else {
    try {
      msg = JSON.stringify(e)
    } catch {
      msg = String(e)
    }
  }
  return `读取提案失败：${msg || '未知错误'}`
}
