// 织卷 · 输入框 @ 引用（纯逻辑，可单测）
// 触发范式参照 GitHub/Slack mention（trigger 字符 + 光标前 token + 候选替换区间），
// 织卷 v1：textarea 不精确跟随光标，浮层固定于输入框上方；插入形态=所见即所得引用文本。
// 后续「注入上下文」轮可复用本文件在发送前解析展开。

export type AtType = '人物' | '章节' | '世界观' | '素材'

export interface AtCandidate {
  type: AtType
  /** 展示/匹配名（章节取约定头题名，无题名取文件名） */
  name: string
  /** 项目相对路径（如 人物/沈藏.md） */
  file: string
}

export const AT_TYPES: AtType[] = ['人物', '章节', '世界观', '素材']

const MAX_QUERY = 30

/**
 * 在 value 的 caret 位置解析 @ 触发。
 * 规则：caret 前最近的 `@`；`@` 前必须行首或空白（避免 a@b）；`@` 后到 caret 间不得含空白/换行；
 * token 可空（刚输入 @）且长度 ≤ MAX_QUERY。
 * 返回 null 表示未触发；否则 { at: '@' 的下标, length: token 长度, query: token }，替换区间=[at, at+1+length)。
 */
export function parseAtTrigger(value: string, caret: number): { at: number; length: number; query: string } | null {
  if (caret <= 0) return null
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const token = before.slice(at + 1)
  if (token.length > MAX_QUERY) return null
  if (/[\s]/.test(token)) return null
  return { at, length: token.length, query: token }
}

/**
 * 候选过滤：query 为空时只出「人物/章节/世界观」（素材库量大，不刷屏）；
 * query 非空四类都出；按名称包含（大小写不敏感）；每类最多 perType、总量 limit。
 */
export function filterAtCandidates(all: AtCandidate[], query: string, opts?: { perType?: number; limit?: number }): AtCandidate[] {
  const perType = opts?.perType ?? 10
  const limit = opts?.limit ?? 30
  const q = query.trim().toLowerCase()
  const out: AtCandidate[] = []
  for (const t of AT_TYPES) {
    if (!q && t === '素材') continue
    const arr = all.filter((c) => c.type === t && (q ? c.name.toLowerCase().includes(q) : true)).slice(0, perType)
    out.push(...arr)
  }
  return out.slice(0, limit)
}

/**
 * 把 @ 触发区间替换为引用文本 `〔类型·名称｜路径〕`（后带一个空格），
 * 返回新 value 与插入后的光标位置（引用文本之后）。
 */
export function insertAtMention(
  value: string,
  trig: { at: number; length: number },
  cand: AtCandidate
): { value: string; caret: number } {
  const repl = `〔${cand.type}·${cand.name}｜${cand.file}〕`
  const tail = value.slice(trig.at + 1 + trig.length)
  // 只在后面不是空白时补一个空格，避免「@名 」替换后出现双空格
  const space = /^\s/.test(tail) ? '' : ' '
  const next = value.slice(0, trig.at) + repl + space + tail
  return { value: next, caret: trig.at + repl.length + space.length }
}
