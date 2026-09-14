/**
 * 工具调用参数摘要（智能层 2026-09-15）：把 dsh 引擎传来的结构化参数压成一行 UI 展示文本。
 * 规则：读文件（file）展示路径、带 offset 则附上（续读链可追溯）；搜索展示 query；其余取前几个键值。
 * 从 engine.ts 私有函数抽到 shared：供主进程 translate 使用，也便于单测验证（工具链「续读」判据依赖此格式）。
 */
export function summarizeToolArgs(args: unknown): string | undefined {
  if (!args) return undefined
  let obj: any = args
  if (typeof args === 'string') {
    try {
      obj = JSON.parse(args)
    } catch {
      return String(args).slice(0, 60)
    }
  }
  if (typeof obj !== 'object' || obj === null) return undefined
  const pick = obj.file ?? obj.query ?? obj.dir
  if (pick !== undefined) {
    const extra = obj.file != null && obj.offset != null ? ` (offset=${obj.offset})` : ''
    return String(pick) + extra
  }
  const keys = Object.keys(obj).filter((k) => !['base'].includes(k))
  if (!keys.length) return undefined
  const k = keys[0]
  const v = obj[k]
  return typeof v === 'string' || typeof v === 'number' ? `${k}=${v}` : k
}
