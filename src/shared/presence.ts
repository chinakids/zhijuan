// ===== 织卷 · 人物在场核查（本地规则层，零模型，2026-09-09） =====
// 调研结论（docs/agent-调研与优化-日志.md）：Novel Crafter 把「Review」做成 Appearance Heatmap /
// Characters per Scene 这类**确定性统计审查**，与 LLM 审查分层；织卷此前只有 LLM 审计（几分钟 + token），
// 缺低成本、秒级、可重复的机械层。本模块做第一块机械审查：逐章对照约定头「涉及人物」与正文实际署名出现，
// 盯两类漂移——清单里的人物没出场（missing）、出场了却不在清单（unlisted）。
// 纯函数、不读盘，OCR 无关；匹配口径：2 字及以上署名做子串匹配，单字名/别名/指代不参与（机械层承认局限）。
import { extractFrontMatter } from './fmatter'
import type { AuditItem, AuditResult } from './types'

export interface PresenceChapter {
  /** 相对项目根的路径，如 正文/第01章_雾港.md */
  file: string
  /** 全文（含 front matter） */
  raw: string
}

/** 从约定头里取「涉及人物」（字符串或数组两种写法都收；无则 []） */
export function listedFrom(fm: Record<string, unknown>): string[] {
  const v = fm['涉及人物']
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    const arr = v.match(/^\[(.*)\]$/)
    if (arr) return arr[1].split(',').map((s) => s.trim()).filter(Boolean)
    return v.trim() ? [v.trim()] : []
  }
  return []
}

const NAME_MIN = 2 // 单字名（姓氏/代号）不做机械匹配，避免全篇误报

function titleOf(fm: Record<string, unknown> | null, file: string): string {
  if (fm && typeof fm['题名'] === 'string' && fm['题名']) return String(fm['题名'])
  return (file.split('/').pop() ?? file).replace(/\.md$/i, '')
}

/**
 * 人物在场核查：输入全部章节（约定头 + 正文）与人物档案题名清单，输出 AuditResult（与审计抽屉同构）。
 * - missing：约定头「涉及人物」列了、但正文未出现署名 → medium
 * - unlisted：正文出现署名、但约定头未列 → low
 */
export function presenceCheck(opts: { knownChars: string[]; chapters: PresenceChapter[] }): AuditResult {
  const known = new Set(opts.knownChars)
  const items: AuditItem[] = []
  let touched = 0
  let missCount = 0
  let unCount = 0
  for (const ch of opts.chapters) {
    const { fm, body } = extractFrontMatter(ch.raw)
    const listed = listedFrom(fm ?? {})
    const title = titleOf(fm, ch.file)
    const where = `${title}（${ch.file}）`
    for (const n of listed) {
      if (n.length < NAME_MIN) continue
      if (!body.includes(n)) {
        missCount++
        touched++
        items.push({
          severity: 'medium',
          type: 'character',
          where,
          what: `「涉及人物」列了「${n}」，但本章正文未出现 TA 的署名（可能已删戏，或只用了别名/指代）。`,
          suggest: `确认本章是否真需要「${n}」出场：需要则在正文补写该角色，不需要就把 TA 移出本章约定头的「涉及人物」。`
        })
      }
    }
    for (const n of known) {
      if (n.length < NAME_MIN) continue
      if (body.includes(n) && !listed.includes(n)) {
        unCount++
        touched++
        items.push({
          severity: 'low',
          type: 'character',
          where,
          what: `正文出现了「${n}」的署名，但本章约定头「涉及人物」没有列 TA。`,
          suggest: `若「${n}」确实在这一章出场，把 TA 加进本章约定头的「涉及人物」；若只是回忆/提及一笔，保留现状即可。`
        })
      }
    }
  }
  const n = opts.chapters.length
  const summary = touched
    ? `人物在场核查（本地规则·零模型）：共 ${n} 章，${touched} 章与「涉及人物」不一致——清单列了却未署名出场 ${missCount} 处、出场却未列入 ${unCount} 处。匹配口径为 2 字及以上署名，别名/单字名/指代不参与；无问题的章未列出。`
    : n
      ? `人物在场核查（本地规则·零模型）：${n} 章全部与约定头「涉及人物」一致。`
      : '人物在场核查（本地规则·零模型）：项目里还没有正文章节。'
  return { summary, items }
}
