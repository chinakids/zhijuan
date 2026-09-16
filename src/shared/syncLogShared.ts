// 同步日志域纯函数（main/engine 与 renderer/devShim 共用；2026-09-16 创作层）
// 单一权威源：真机 runSync 三处返回与 devShim mock 失败路径都用它截断 error 摘要，防两套实现漂移。

/** 错误摘要截断（同步日志口径：截断 120 字，与引擎侧错误文案同规则） */
export function clipLogError(s: string): string {
  const t = s.trim()
  return t.length > 120 ? t.slice(0, 120) + '…' : t
}
