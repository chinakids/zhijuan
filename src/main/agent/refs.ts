// ===== 织卷 · @ 引用展开（2026-09-11 智能层；后附与技能 note 一致） =====
// 输入框 @ 功能的另一半闭环：用户消息里的 〔类型·名称｜路径〕 引用标记，发送时由主进程
// 读取对应文档内容并注入本轮 agent 上下文（对照 Cursor @ mention = 把文件内容 attach 进对话，
// https://cursor.com/help/customization/context，2026-09-11 调研）。
// 引用标记解析与预算常量在 shared/atRefs.ts（main/renderer 同口径），本文件负责读文件真链路。
import { readDoc } from '../store'
import { parseAtRefs, REF_CAP, type AtRef } from '../../shared/atRefs'

export { parseAtRefs, REF_CAP, type AtRef }

export interface InflatedRef extends AtRef {
  /** 文件读到了非空内容 */
  found: boolean
  /** 已剥 front matter、已按预算截断的内容（未找到时为空串） */
  content: string
  /** 因预算被截断（found 时才有意义） */
  truncated: boolean
}

/** 剥 front matter：仅正文章节（章号/题名/切片/涉及人物 是元数据）；人物/世界观/素材文件的
 *  约定头字段（如 姓名/身份）也是档案内容，与 buildWritingContext 口径一致保留原样。 */
function stripFrontMatter(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n/)
  return m ? raw.slice(m[0].length) : raw
}

/**
 * 逐个读内容并套预算（read 以 file 为参数，便于单测注入；真机传 readDoc 包装）。
 * 规则：每个引用 ≤each 字符，引用合计 ≤total 字符；超预算从开头截断并标记；
 * 读不到/空 → found=false，内容为空，注入块会提示模型可 zj_read_doc 现读。
 */
export function inflateRefs(
  refs: AtRef[],
  read: (file: string) => string,
  cap: { each: number; total: number } = REF_CAP
): InflatedRef[] {
  const out: InflatedRef[] = []
  let used = 0
  for (const r of refs) {
    const remain = Math.max(0, cap.total - used)
    let raw = ''
    try {
      raw = read(r.file) ?? ''
    } catch {
      raw = ''
    }
    if (r.type === '章节') raw = stripFrontMatter(raw)
    raw = raw.trim()
    const found = raw.length > 0
    let content = ''
    let truncated = false
    if (found) {
      const allow = Math.min(cap.each, remain)
      content = raw.slice(0, allow)
      truncated = content.length < raw.length
      used += content.length
    }
    out.push({ ...r, found, content, truncated })
  }
  return out
}

/** 组装注入上下文块；无引用或全部未找到且无内容时返回 null */
export function refsBlock(inflated: InflatedRef[]): string | null {
  if (!inflated.length) return null
  const parts: string[] = []
  for (const r of inflated) {
    const label = `〔${r.type}·${r.name}｜${r.file}〕`
    if (!r.found) {
      parts.push(`${label}\n（文件未读到或为空——可忽略本引用，需要时用 zj_read_doc 读取该文件）`)
      continue
    }
    let body = r.content
    if (r.truncated) {
      body = `（引用内容已超预算，装配的是开头部分，还需更多请用 zj_read_doc 读取完整文件）\n${body}`
    }
    parts.push(`${label}\n${body}`)
  }
  return `【用户引用展开】用户消息中的 @ 引用标记对应内容如下，可直接作为事实使用；需要更完整内容时用 zj_read_doc 读取对应文件。\n${parts.join('\n\n')}`
}

/** 完整入口：解析 → 读文件 → 组装；无引用时返回 null 块（零开销短路） */
export async function expandAtRefs(projectId: string, text: string): Promise<{ refs: InflatedRef[]; block: string | null }> {
  const refs = parseAtRefs(text)
  if (!refs.length) return { refs: [], block: null }
  const inflated = inflateRefs(refs, (f) => readDoc(projectId, f) ?? '')
  return { refs: inflated, block: refsBlock(inflated) }
}
