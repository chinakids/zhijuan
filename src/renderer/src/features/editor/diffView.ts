// ===== 正文版本历史 · 轻量行级 diff 视图构建（纯函数，可单测）=====
// 基于 jsdiff diffLines（Myers O(ND)，零依赖），把 change 流折算成「可视行序列」：
// 只保留变化行及前后 context 行，被省略的上下文以 skipped 计数标记；结果可直接逐行渲染（红−绿＋）。
import { diffLines } from 'diff'

export interface DiffRow {
  kind: 'eq' | 'del' | 'ins'
  text: string
  /** 本行之前被省略的普通上下文行数（>0 时 UI 画省略分隔） */
  skipped?: number
}

export interface DiffViewResult {
  rows: DiffRow[]
  /** 删除行数（含省略区外的全部变更行） */
  del: number
  /** 新增行数 */
  ins: number
  /** 结果行是否被截断（> DIFF_MAX_ROWS 时尾部省略） */
  truncated: boolean
}

export const DIFF_CTX = 2
export const DIFF_MAX_ROWS = 1200

/**
 * 将 diffLines 的 change 流折叠成可视行序列。
 * 相同文本返回空 rows（del/ins 均为 0，UI 显示「无差异」）。
 */
export function buildDiffView(oldText: string, newText: string, context = DIFF_CTX, maxRows = DIFF_MAX_ROWS): DiffViewResult {
  const changes = diffLines(oldText, newText)
  interface RowT { kind: 'eq' | 'del' | 'ins'; text: string }
  const rows: RowT[] = []
  let del = 0
  let ins = 0
  for (const c of changes) {
    if (c.removed) del += c.count
    if (c.added) ins += c.count
    let lines = c.value.split('\n')
    // diffLines 的 value 以 \n 结尾时最后是空串（尾随换行），去掉；中间空行保留
    if (lines.length > 0 && lines[lines.length - 1] === '') lines = lines.slice(0, -1)
    const kind: RowT['kind'] = c.added ? 'ins' : c.removed ? 'del' : 'eq'
    for (const t of lines) rows.push({ kind, text: t })
  }
  // 变化段范围（连续的 del/ins）
  const ranges: [number, number][] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'eq') continue
    const s = i
    while (i + 1 < rows.length && rows[i + 1].kind !== 'eq') i++
    ranges.push([s, i])
  }
  if (ranges.length === 0) return { rows: [], del: 0, ins: 0, truncated: false }
  // 保留：变化段向外扩 context 行；相邻段重叠自然合并
  const keep = new Set<number>()
  for (const [s, e] of ranges) {
    for (let i = Math.max(0, s - context); i <= Math.min(rows.length - 1, e + context); i++) keep.add(i)
  }
  const out: DiffRow[] = []
  let prev = -1
  for (let i = 0; i < rows.length; i++) {
    if (!keep.has(i)) continue
    const r: DiffRow = { kind: rows[i].kind, text: rows[i].text }
    if (prev >= 0) {
      const gap = i - prev - 1
      if (gap > 0) r.skipped = gap
    }
    out.push(r)
    prev = i
  }
  let truncated = false
  if (out.length > maxRows) {
    const rest = out.length - maxRows
    let final: DiffRow[]
    if (maxRows >= 1) {
      final = out.slice(0, maxRows)
      const last = final[final.length - 1]
      last.skipped = (last.skipped ?? 0) + rest
    } else {
      final = []
    }
    truncated = true
    return { rows: final, del, ins, truncated }
  }
  return { rows: out, del, ins, truncated }
}
