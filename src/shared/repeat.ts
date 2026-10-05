// ===== 织卷 · 复读检测（本地规则层，零模型，2026-10-05） =====
// 调研结论（来源=ProWritingAid 官方，2026-10-05 CDP 9224 实抓）：
//   • features/writing-reports「All Repeats = Detect if you overuse certain phrases」；
//     「Echoes = Remove repetitions in proximity」（邻近重复）；
//     「Sentence Structure = Check how varied your sentence structures are」。
//   • repetition-checker FAQ「identifies repeated words and phrases… Repeated words detract
//     from your message and result in a dull tone」。
//   • Blog Tip #17「Don't repeat sentence starts」（art/250）：每句同形开头 = monotonous、
//     laundry-list 感；唯一例外 = anaphora（顶真/排比，刻意重复），「just don't overdo it」。
//   • Blog Tip #7「Don't repeat yourself」（art/260）：重复让读者想「Didn't I just read that?」。
// 产品定位：织卷已有 overuse（词表式频率=全书层面「口头禅/高频短语」）；本块补**章内句/段级复读**
//   ——人机协作特有的模型复读面（续写把前文句子原样/近似复述、整段复写），也是作者长文校对
//   难察觉的模式（Tip#17：需朗读才听得出）。与 overuse 互补：overuse 管「词」，repeat 管「句/段」。
// 判据严格性取自零误报基线（2026-10-05 本机只读实测）：
//   都市短篇合集 19 章 16.3 万字（作者手写）：≥14 字完全重复句 0、≥20 字完全重复段 0、
//   连续 ≥3 句同句首 0、相邻段近重复 0 —— 作者手写天然零命中；
//   仅「同句首 2 连（≤3 句窗）」10 条（多为同场景同一主语连续，属可接受写作）→ 故定 low。
//   模型复读（复述/复写）会落入完全重复与句首模式，检查命中即提示，不判作者对错（作者自决）。
// 与 presence/order/nameform/overuse 同构：纯函数、不读盘、输出 AuditItem[]、零模型秒级。
import { stripHtmlComments } from './comments'
import { splitSentences } from './writingInsights'
import type { AuditItem } from './types'

/** 判据常量（2026-10-05 真数据评估定值；改前先复跑评估脚本口径，勿凭直觉调） */
export const REPEAT_CAPS = {
  /** 完全重复句最小标准化长度（避开口头禅短句/对话短句噪音） */
  minSentenceLen: 14,
  /** 完全重复段最小标准化长度 */
  minParaLen: 20,
  /** 句首模式比较前缀长度（标准化后前 N 字） */
  startPrefixLen: 4,
  /** 句首模式参与句的最小长度（短句同首常见，不算模式） */
  startMinLen: 14,
  /** 句首模式窗口：两同首句之间的中间句数 ≤ 此值才计入（Proximity 语义） */
  startWindow: 3
} as const

export interface RepeatHit {
  kind: 'sentence' | 'paragraph' | 'sentence-start'
  severity: 'high' | 'medium' | 'low'
  /** 命中文本（截断到 40 字） */
  text: string
  /** 完全重复时出现次数；句首模式时为同首句数（含排比例外说明由 suggest 承担） */
  count: number
  /** 句首模式：同形前缀 */
  prefix?: string
  file: string
}

/** 标准化比较键：去空白与标点，只留中英文数字（句子/段落等价比较用） */
export function normRepeatKey(s: string): string {
  return String(s)
    .replace(/[\s\u3000]+/g, '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
}

/** 标记行判据：章节内分隔符/标题/加粗括注（如「**（第 15 人 · …）**」「——」「### 场景」）。
 *  真数据评估实测：不加此过滤，章节标记行会被当重复句误报（第十一章「（第15人…）」双现）。 */
export function isMarkerLine(s: string): boolean {
  const t = String(s).trim()
  if (!t) return true
  if (/^#{1,6}\s/.test(t)) return true
  if (/^[\s\-*_~·|:=]+$/.test(t)) return true
  if (/^\*\*.+\*\*\s*$/.test(t)) return true
  // 无中文的行多半是分隔/外语注释（正文中文创作，不参与复读检查）
  if (!/[\u4e00-\u9fff]/.test(t)) return true
  return false
}

/** 单章正文 → 有效段落列表（剥约定头/注释/markdown 前缀/标记行）。
 *  注意：标记行判据必须在剥 markdown 符号**之前**（「**（第 15 人…）**」剥后=14 字普通文本，
 *  实测会当重复句误报——第十一章实锤形态）。 */
export function paragraphsOf(raw: string): string[] {
  const visible = stripHtmlComments(String(raw).replace(/^---\n[\s\S]*?\n---\s*(\n|$)/, ''))
  const out: string[] = []
  for (const line of visible.split('\n')) {
    const rawLine = line.trim()
    if (!rawLine) continue
    if (isMarkerLine(rawLine)) continue
    const s = rawLine.replace(/[`*_~#>]/g, '').replace(/^#{1,6}\s*/, '').trim()
    if (!s || isMarkerLine(s)) continue
    out.push(s)
  }
  return out
}

/** 章内句子收集：段落 → splitSentences（同一口径复用 writingInsights）；同样跳过标记行衍生的内容 */
export function sentencesOf(raw: string): string[] {
  const out: string[] = []
  for (const p of paragraphsOf(raw)) {
    for (const s of splitSentences(p)) {
      out.push(s)
    }
  }
  return out
}

/** 章内复读检测（单章）：完全重复句 / 完全重复段 / 句首模式。
 *  返回按「完全重复 → 句首模式」顺序的命中列表；句首组与完全重复句不重复报（组内含全等句时跳过）。 */
export function repeatCheckFile(file: string, raw: string): RepeatHit[] {
  const hits: RepeatHit[] = []
  const paras = paragraphsOf(raw)
  const sents = sentencesOf(raw)

  // 1) 完全重复段（≥ minParaLen）：同一标准化段在章内 ≥2 次
  {
    const acc = new Map<string, { text: string; n: number }>()
    for (const p of paras) {
      const k = normRepeatKey(p)
      if (k.length < REPEAT_CAPS.minParaLen) continue
      const cur = acc.get(k)
      if (cur) cur.n++
      else acc.set(k, { text: p, n: 1 })
    }
    for (const [, v] of acc) {
      if (v.n >= 2) {
        hits.push({
          kind: 'paragraph',
          severity: 'medium',
          text: v.text.slice(0, 40),
          count: v.n,
          file
        })
      }
    }
  }

  // 2) 完全重复句（≥ minSentenceLen）：同一标准化句在章内 ≥2 次
  {
    const acc = new Map<string, { text: string; n: number }>()
    for (const s of sents) {
      const k = normRepeatKey(s)
      if (k.length < REPEAT_CAPS.minSentenceLen) continue
      const cur = acc.get(k)
      if (cur) cur.n++
      else acc.set(k, { text: s, n: 1 })
    }
    for (const [, v] of acc) {
      if (v.n >= 2) {
        hits.push({
          kind: 'sentence',
          severity: 'medium',
          text: v.text.slice(0, 40),
          count: v.n,
          file
        })
      }
    }
  }

  // 3) 句首模式：同形前 4 字且在窗口（任两同首句中间句 ≤ startWindow）内的句 ≥2；
  //    组内若存在全等句对 → 交给「完全重复句」报，本组不双报
  {
    const entries: { key: string; text: string; full: string }[] = []
    for (const s of sents) {
      const full = normRepeatKey(s)
      if (full.length < REPEAT_CAPS.startMinLen) continue
      entries.push({ key: full.slice(0, REPEAT_CAPS.startPrefixLen), text: s, full })
    }
    // 先标记全等（完全重复）句的 key
    const fullDup = new Set<string>()
    {
      const cnt = new Map<string, number>()
      for (const e of entries) cnt.set(e.full, (cnt.get(e.full) ?? 0) + 1)
      for (const e of entries) if ((cnt.get(e.full) ?? 0) >= 2) fullDup.add(e.full)
    }
    const reported = new Set<string>()
    const W = REPEAT_CAPS.startWindow
    for (let i = 0; i < entries.length; i++) {
      if (reported.has(entries[i].key)) continue
      const members: string[] = []
      let hasFullDup = false
      for (let j = Math.max(0, i - W); j <= Math.min(entries.length - 1, i + W); j++) {
        if (entries[j].key !== entries[i].key) continue
        members.push(entries[j].full)
        if (fullDup.has(entries[j].full)) hasFullDup = true
      }
      if (members.length < 2) continue
      reported.add(entries[i].key)
      if (hasFullDup) continue
      hits.push({
        kind: 'sentence-start',
        severity: members.length >= 3 ? 'medium' : 'low',
        text: entries[i].text.slice(0, 40),
        count: members.length,
        file
      })
    }
  }

  return hits
}

export interface RepeatOpts {
  /** 允许覆盖判据（二期/测试用；缺省 REPEAT_CAPS） */
  caps?: Partial<typeof REPEAT_CAPS>
}

/** 全卷复读检测：chapters=[{file, raw}] → 章内命中列表（不排序，章序=输入序） */
export function repeatCheck(
  chapters: { file: string; raw: string }[],
  _opts: RepeatOpts = {}
): RepeatHit[] {
  const out: RepeatHit[] = []
  for (const c of chapters) {
    out.push(...repeatCheckFile(c.file, c.raw))
  }
  return out
}

/** 复读检测 → 审计条目（与 overuse/nameform 等本地规则同构）。
 *  severity/建议口径：完全重复句/段=medium（大概率模型复读或草稿残留，但有意回声可忽略）；
 *  句首 2 连=low（ProWritingAid Tip#17 单调清单模式，作者手写也偶发=提示不打断） */
export function repeatItems(chapters: { file: string; raw: string }[]): AuditItem[] {
  return repeatCheck(chapters).map((h) => {
    if (h.kind === 'sentence') {
      return {
        severity: h.severity,
        type: 'repeat',
        where: h.file,
        what: `「${h.text}…」在本章重复出现 ${h.count} 次（同文句子原样再现）`,
        suggest: '大概率是模型复读或草稿残留——建议改写其一；若为有意回声（人物重复台词/呼应）可忽略'
      }
    }
    if (h.kind === 'paragraph') {
      return {
        severity: h.severity,
        type: 'repeat',
        where: h.file,
        what: `「${h.text}…」整段在本章重复出现 ${h.count} 次`,
        suggest: '整段复写通常是复读事故——参考前一处改写；若为刻意重复（排比/转场复现）可忽略'
      }
    }
    return {
      severity: h.severity,
      type: 'repeat',
      where: h.file,
      what: `本章有 ${h.count} 句以「${h.text.slice(0, 8)}」同形开头（相邻句）`,
      suggest:
        '连续多句同形开头会形成单调清单感（读者易出戏）——变换句首或用不同状语；若为排比（anaphora）刻意统一可忽略'
    }
  })
}
