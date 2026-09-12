// ===== 织卷 · 批注工具（对齐主人批注流程约定：批注任务脚本.py） =====
// 批注 csv：与目标 md 同目录同名（<名>_批注.csv ↔ <名>.md）；无表头；
// 每行两列：位置（L<行>:<列>-L<行>:<列>，1-based，同行内）, 批注意图。
// 处理语义（与脚本 remove/cull 一致）：按批注意图改完（或拒绝）后删除该行；空文件删除。
// 本文件只做纯解析/定位，无文件系统依赖，可在 renderer 与 node 两侧共用（含 devShim/单测）。

export interface AnnotationRow {
  /** 位置串；空行/坏行保留占位（行号 1:1 对齐 csv 原文，与 csv.reader 不跳行口径一致） */
  loc: string
  note: string
}

/** 单行 CSV 解析（RFC4180 简化：双引号包裹的字段可含逗号与转义引号；字符级逐格） */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** 解析整份批注 csv：保留空行（行号与 csv.reader 口径一致），仅空 loc 的行标记不处理 */
export function parseAnnotationCsv(text: string): AnnotationRow[] {
  const arr = text.split(/\r?\n/)
  if (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
  return arr.map((l) => {
    const [loc, ...rest] = parseCsvLine(l)
    return { loc: (loc ?? '').trim(), note: rest.join(',').trim() }
  })
}

/** L7:11-L7:41 → { sl, sc, el, ec }（1-based；仅同行；不合法返回 null） */
export function parseLoc(loc: string): { sl: number; sc: number; el: number; ec: number } | null {
  const m = /^L(\d+):(\d+)-L(\d+):(\d+)$/.exec(loc.trim())
  if (!m) return null
  const sl = +m[1]
  const sc = +m[2]
  const el = +m[3]
  const ec = +m[4]
  if (sl < 1 || el < 1 || sc < 1 || ec < 1 || sl !== el) return null
  return { sl, sc, el, ec }
}

/** 按 loc 从章节全文取文段：与主人脚本 get_segment 同义（Python 切片语义——结束列越界钳到行尾；仅同行）。
 * 坏 loc / 起始列越界返回 null。 */
export function segmentFromText(text: string, loc: string): string | null {
  const p = parseLoc(loc)
  if (!p) return null
  const lines = text.split('\n')
  if (p.sl > lines.length) return null
  const line = lines[p.sl - 1]
  if (p.sc > line.length + 1) return null
  const end = Math.min(p.ec - 1, line.length)
  if (end < p.sc - 1) return null
  return line.slice(p.sc - 1, end)
}
