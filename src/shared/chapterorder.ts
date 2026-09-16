// ===== 织卷 · 切片时序核查（本地规则层，零模型，2026-09-09） =====
// 机械审查层第二块（第一块=人物在场 presence）：守护「章节头约定」这个全文唯一半结构化的排序锚。
// 检查机器可判定的时序结构问题：
//   R1 约定头「章号」缺失/非正整数（medium）
//   R2 约定头章号 ≠ 文件名第N章（medium）
//   R3 章号重复（medium）
//   R4 章号跳号（low：草稿常见，可能是未写/已删章）
//   R5 切片序号倒流（medium：带「第X」的切片名按章号顺序递减，可能是写反或有意的插叙）——按线内判定
//   R6 同一「切片」名在**同一条线内**被不连续的章号共用（low：闪回常见，也可能是标错切片）
//   R7 同一切片名被多条时间线共用（low：约定建议切片名全局唯一，跨线加线前缀；系统不拦截只提示）
// 口径（机械层承认局限）：切片名里带「第X」（中文/阿拉伯）序号才参与 R5 顺序比较；
// 无序号的切片名跳过顺序检查但按名字参与 R6/R7 分组；单字名/简称不参与（同 presence 哲学）。
// 线内判定（2026-09-16 多时间线叙事）：R5/R6 只在**同一条线内**比较——多线交错时全局比较会把
// 有意的跨线切换误报成倒流/滥用（设计文档 §4.4「审计切片序号倒流/同名切片共用改为线内判定」）。
// 与 presenceCheck 同构：纯函数、不读盘，输出 AuditResult（审计抽屉渲染）。
import { extractFrontMatter } from './fmatter'
import { chapterLine } from './line'
import type { AuditItem, AuditResult } from './types'

export interface OrderChapter {
  /** 相对项目根的路径，如 正文/第01章_雾港.md */
  file: string
  /** 全文（含 front matter） */
  raw: string
}

const DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}

/** 中文数字 → 整数（支持 0-999 常规写法：一/十二/二十一/百/一百/一百零五/两）；阿拉伯数字串直接解析；解析不了返回 null */
export function cnToInt(s: string): number | null {
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : null
  }
  let total: number | null = null
  if (s.includes('百')) {
    const [h, restRaw] = s.split('百')
    const hv = h ? DIGITS[h] : 1
    if (hv === undefined) return null
    total = hv * 100
    const rest = (restRaw ?? '').replace(/[零〇]/g, '')
    if (!rest) return total
    s = rest
  }
  if (s.includes('十')) {
    const [tRaw, oRaw] = s.split('十')
    const t = (tRaw ?? '').replace(/[零〇]/g, '')
    const o = (oRaw ?? '').replace(/[零〇]/g, '')
    const tv = t ? DIGITS[t] : 1
    if (tv === undefined) return null
    let v = tv * 10
    if (o) {
      const ov = DIGITS[o]
      if (ov === undefined) return null
      v += ov
    }
    return (total ?? 0) + v
  }
  if (s.length === 1 && DIGITS[s] !== undefined) return (total ?? 0) + DIGITS[s]
  return null
}

/** 切片名里的「第X」序号（取第一个「第X」：第一幕_夜→1、第2夜→2、第二季_第3集→2） */
export function sliceOrdinal(name: string): number | null {
  const m = name.match(/第\s*([一二三四五六七八九十百零〇两0-9]+)/)
  return m ? cnToInt(m[1]) : null
}

function titleOf(fm: Record<string, unknown> | null, file: string): string {
  if (fm && typeof fm['题名'] === 'string' && fm['题名']) return String(fm['题名'])
  return (file.split('/').pop() ?? file).replace(/\.md$/i, '')
}

/** 约定头「章号」→ 正整数；缺失/非正整数返回 null */
function fmNo(fm: Record<string, unknown> | null): number | null {
  const v = fm?.['章号']
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 文件名（正文/第01章_雾港.md）里的章号 */
function fileNo(file: string): number | null {
  const m = file.match(/第\s*(\d+)\s*章/)
  return m ? parseInt(m[1], 10) : null
}

interface Row {
  file: string
  title: string
  /** 排序用章号：约定头优先，其次文件名编号；都无 → Infinity（排最后，不参与比较） */
  sortNo: number
  headNo: number | null
  fNo: number | null
  slice: string
  /** 所属时间线（章头「时间线」，缺省=主线） */
  line: string
}

/**
 * 切片时序核查：输入全部章节（约定头 + 正文 raw），输出 AuditResult（与审计抽屉同构）。
 * 只返回「确有依据」的问题；跳号/倒流可能是刻意的（草稿/闪回），措辞留给作者复核。
 */
export function chapterOrderCheck(opts: { chapters: OrderChapter[] }): AuditResult {
  const items: AuditItem[] = []
  const rows: Row[] = []
  for (const ch of opts.chapters) {
    const { fm } = extractFrontMatter(ch.raw)
    const headNo = fmNo(fm)
    const fNo = fileNo(ch.file)
    const slice = String(fm?.['切片'] ?? '').trim()
    const title = titleOf(fm, ch.file)
    const where = `${title}（${ch.file}）`
    if (headNo === null) {
      items.push({
        severity: 'medium',
        type: 'timeline',
        where,
        what: '约定头「章号」缺失或不是正整数——切片同步、正文章卡、agent 上下文都按章号排序，缺号会让顺序不可靠。',
        suggest: fNo !== null ? `在文件头部 front matter 补上「章号: ${fNo}」（与文件名编号一致）。` : '在文件头部 front matter 补上「章号: N」。'
      })
    }
    if (headNo !== null && fNo !== null && headNo !== fNo) {
      items.push({
        severity: 'medium',
        type: 'timeline',
        where,
        what: `约定头「章号」写的是 ${headNo}，但文件名是 第${fNo}章，两处不一致。`,
        suggest: '把约定头「章号」改成与文件名编号一致（涉及人物清单与切片索引都按章号工作）。'
      })
    }
    rows.push({ file: ch.file, title, sortNo: headNo ?? fNo ?? Number.POSITIVE_INFINITY, headNo, fNo, slice, line: chapterLine(fm) })
  }

  const n = rows.length

  // R3 章号重复：sortNo 分组（有限值）
  const byNo = new Map<number, Row[]>()
  for (const r of rows) {
    if (r.sortNo === Number.POSITIVE_INFINITY) continue
    const arr = byNo.get(r.sortNo) ?? []
    arr.push(r)
    byNo.set(r.sortNo, arr)
  }
  for (const [no, list] of byNo) {
    if (list.length <= 1) continue
    items.push({
      severity: 'medium',
      type: 'timeline',
      where: list.map((r) => `${r.title}（${r.file}）`).join('；'),
      what: `「章号: ${no}」被 ${list.length} 个章节共用（章号必须唯一才能稳定排序与引用）。`,
      suggest: `给其中一章改为别的章号（如 第${no}章 与 第${no + 1}章 顺延），并同步文件名。`
    })
  }

  // R4 章号跳号（low：草稿常见）
  const keys = [...byNo.keys()].sort((a, b) => a - b)
  const gaps: string[] = []
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] - keys[i - 1] > 1) gaps.push(`${keys[i - 1]}→${keys[i]}`)
  }
  if (gaps.length) {
    items.push({
      severity: 'low',
      type: 'timeline',
      where: `全卷共 ${n} 章，章号不连续：${gaps.slice(0, 3).join('、')}${gaps.length > 3 ? ' 等' : ''}。`,
      what: '相邻章号之间存在空缺（可能还有未写的章节，或已删章节未重新编号）。',
      suggest: '草稿阶段常见，可忽略；若作品已成型，请在补齐或删除后统一重排章号。'
    })
  }

  // R5 切片序号倒流（medium）：**线内**按章号升序，同线相邻可解析序号的切片不得递减
  // （多线交错时全局比较会把跨线切换误报成倒流；线内比较只报真问题）
  const lineRows = new Map<string, Row[]>()
  for (const r of rows) {
    if (r.sortNo === Number.POSITIVE_INFINITY) continue // 章号完全无法解析的章不参与顺序比较
    const arr = lineRows.get(r.line) ?? []
    arr.push(r)
    lineRows.set(r.line, arr)
  }
  for (const rs of lineRows.values()) {
    const sorted = [...rs].sort((a, b) => a.sortNo - b.sortNo)
    let prev: Row | null = null
    for (const r of sorted) {
      const so = r.slice ? sliceOrdinal(r.slice) : null
      if (so === null) continue
      if (prev) {
        const po = sliceOrdinal(prev.slice)
        if (po !== null && so < po) {
          items.push({
            severity: 'medium',
            type: 'timeline',
            where: `${prev.title}（${prev.file}）→ ${r.title}（${r.file}）`,
            what: `切片序号倒流：前序章的切片「${prev.slice}」（第 ${po}）晚于本章的「${r.slice}」（第 ${so}），按章号顺序时间线向后跳了。`,
            suggest: '若为有意的插叙/倒叙可忽略；否则检查这两章约定头「切片」是否写反，或章节顺序需要调整。'
          })
        }
      }
      prev = r
    }
  }

  // R6 同一「切片」名在**同一条线内**被不连续的章号共用（low）——线内判定，跨线同名不视为 R6
  const bySlice = new Map<string, { slice: string; line: string; nos: number[] }>()
  for (const r of rows) {
    if (!r.slice || r.sortNo === Number.POSITIVE_INFINITY) continue
    const key = r.line + '\u0000' + r.slice
    const cur = bySlice.get(key) ?? { slice: r.slice, line: r.line, nos: [] }
    cur.nos.push(r.sortNo)
    bySlice.set(key, cur)
  }
  for (const { slice, nos } of bySlice.values()) {
    const sortedNos = [...new Set(nos)].sort((a, b) => a - b)
    if (sortedNos.length <= 1) continue
    let ok = true
    for (let i = 1; i < sortedNos.length; i++) {
      if (sortedNos[i] - sortedNos[i - 1] > 1) {
        ok = false
        break
      }
    }
    if (!ok) {
      items.push({
        severity: 'low',
        type: 'timeline',
        where: `切片「${slice}」被 第 ${sortedNos.join('、')} 章共用。`,
        what: '同一切片名出现在不连续的章节里，中间隔着其他切片——可能是跨章倒叙，也可能是切片标错。',
        suggest: '若为有意的闪回可忽略；否则请把同一时间段的连续章节统一到同一切片名，或修正标错的约定头。'
      })
    }
  }

  // R7 同一切片名被多条时间线共用（low）——约定建议全局唯一（跨线加线前缀），系统不拦截只提示
  const sliceLines = new Map<string, Set<string>>()
  const sliceNos = new Map<string, Map<string, number[]>>() // slice → line → nos
  for (const r of rows) {
    if (!r.slice || r.sortNo === Number.POSITIVE_INFINITY) continue
    const lines = sliceLines.get(r.slice) ?? new Set<string>()
    lines.add(r.line)
    sliceLines.set(r.slice, lines)
    const byLine = sliceNos.get(r.slice) ?? new Map<string, number[]>()
    const lns = byLine.get(r.line) ?? []
    lns.push(r.sortNo)
    byLine.set(r.line, lns)
    sliceNos.set(r.slice, byLine)
  }
  for (const [slice, lines] of sliceLines) {
    if (lines.size < 2) continue
    const parts = [...lines].map((l) => {
      const lns = [...new Set(sliceNos.get(slice)?.get(l) ?? [])].sort((a, b) => a - b)
      return lns.length ? `「${l}」（第 ${lns.join('、')} 章）` : `「${l}」`
    })
    items.push({
      severity: 'low',
      type: 'timeline',
      where: `切片「${slice}」出现在 ${lines.size} 条时间线：${parts.join('、')}。`,
      what: `同一切片名被多条时间线使用——约定建议切片名全局唯一，人物/世界状态小节按切片名分档，跨线重名会让「按线分叉」的判定失去依据。`,
      suggest: `给其中一条线的切片名加线前缀（如「过去·${slice}」）保持全局唯一；确需共用时在切片名注明所属线以便区分。`
    })
  }

  const summaryHead = n
    ? `切片时序核查（本地规则·零模型）：共 ${n} 章，${items.length} 条需复核（章号结构 / 切片顺序）。`
    : '切片时序核查（本地规则·零模型）：项目里还没有正文章节。'
  const caveat =
    '口径：约定头「章号」与文件名编号不一致、重复、跳号或切片序号倒流都会被标出；带「第X」序号的切片名才参与顺序比较，无序号的切片名跳过顺序检查；跳号/倒流可能是刻意的（草稿空章、插叙），请按建议复核后再改。'
  return { summary: summaryHead + caveat, items }
}
