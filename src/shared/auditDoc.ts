// ===== 织卷 · 审读报告文档的读写单源（智能层 2026-09-12 三期）=====
// auditToMarkdown（main/agent/audit.ts）与 devShim 落盘曾各自拼模板——devShim 是简化格式，
// 导致「与上次对比」在 dev 模式解析不出条目。现收敛到此文件：写（auditDocMarkdown）与读
// （parseAuditMarkdown）同源，模板格式永不漂移；主要进程 auditToMarkdown 委托本文件。
// 格式约定保持一期口径：档头一句话 + 「## 一句话结论」+「## 条目（N）」+ 每条
// 「### i · [sev] type[·viewer]」+「- 位置/现象/建议/关联档案：」行——与旧报告完全兼容（可 parse 旧档）。
import type { AuditItem, AuditResult } from './types'

/** 条目 type 中文 → 键（auditToMarkdown 输出侧；未知 type 原样透传） */
export const AUDIT_TYPE_CN: Record<string, string> = {
  'setting-conflict': '设定冲突',
  timeline: '时间线',
  foreshadow: '伏笔',
  'character-drift': '人物漂移',
  structure: '结构',
  pacing: '节奏',
  character: '人物',
  prose: '行文',
  setting: '设定',
  misc: '其他'
}
export const AUDIT_SEV_CN: Record<AuditItem['severity'], string> = { high: '高', medium: '中', low: '低' }

/** 报告 markdown（纯函数、可单测；格式与历次 auditToMarkdown 完全一致，不含新增机器块） */
export function auditDocMarkdown(
  result: AuditResult,
  kindName: string,
  opts: { now?: string } = {}
): string {
  const now = opts.now ?? new Date().toLocaleString('zh-CN', { hour12: false })
  const lines: string[] = []
  lines.push(`# 审读报告 · ${kindName}`)
  lines.push('')
  lines.push(`> 织卷写作引擎 · ${now} · 每次重跑覆盖本文件，上一版历史自动留存于项目内 .zhijuan/history/（大纲/审读_<类名>/）`)
  lines.push('')
  lines.push('## 一句话结论')
  lines.push('')
  lines.push(result.summary.trim() ? result.summary.trim() : '（无总结）')
  lines.push('')
  lines.push(`## 条目（${result.items.length}）`)
  lines.push('')
  if (!result.items.length) {
    lines.push('这一遍没有发现问题。')
  } else {
    result.items.forEach((it, i) => {
      const viewer = it.viewer ? ` · ${it.viewer}` : ''
      lines.push(`### ${i + 1} · [${AUDIT_SEV_CN[it.severity]}] ${AUDIT_TYPE_CN[it.type] ?? it.type}${viewer}`, '')
      lines.push(`- 位置：${it.where}`)
      lines.push(`- 现象：${it.what}`)
      lines.push(`- 建议：${it.suggest}`)
      if (it.target) lines.push(`- 关联档案：${it.target}`)
      lines.push('')
    })
  }
  lines.push('---', '')
  lines.push('*本报告由织卷全卷检查自动生成；条目可在「Agent 面板 → 全卷检查」逐条转提案。*', '')
  return lines.join('\n')
}

const SEV_CN_TO_KEY: Record<string, AuditItem['severity']> = { 高: 'high', 中: 'medium', 低: 'low' }
const TYPE_CN_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(AUDIT_TYPE_CN).map(([k, v]) => [v, k])
)
const VIEWER_RE = '角色粉|设定党|节奏读者'

/**
 * 从报告 md 还原结构化结果（供「与上次对比」使用）。
 * 逐行解析自己的模板：`### N · [sev] type[·viewer]` + `- 位置/现象/建议/关联档案：`。
 * 容错：非审读报告（无「# 审读报告 ·」标题）→ null；模板外行忽略；字段值含换行时截断（尽力而为，
 * 新版报告由本模板生成、字段单行，不受影响）；解析出的空条目（where/what 皆空）丢弃。
 */
export function parseAuditMarkdown(md: string): AuditResult | null {
  if (typeof md !== 'string' || !md.trim()) return null
  if (!/^#\s*审读报告\s*·/m.test(md)) return null
  let summary = ''
  const mSum = md.match(/##\s*一句话结论\s*\n([\s\S]*?)\n##\s*条目/)
  if (mSum) summary = mSum[1].trim()
  const items: AuditItem[] = []
  let cur: AuditItem | null = null
  for (const line of md.split('\n')) {
    const h = line.match(new RegExp(`^###\\s*\\d+\\s*·\\s*\\[(高|中|低)\\]\\s*(\\S+?)(?:\\s*·\\s*(${VIEWER_RE}))?$`))
    if (h) {
      if (cur) items.push(cur)
      cur = {
        severity: SEV_CN_TO_KEY[h[1]] ?? 'medium',
        type: TYPE_CN_TO_KEY[h[2]] ?? h[2],
        where: '',
        what: '',
        suggest: '',
        ...(h[3] ? { viewer: h[3] } : {})
      }
      continue
    }
    if (!cur) continue
    const f = line.match(/^-\s*(位置|现象|建议|关联档案)：\s*(.*)$/)
    if (!f) continue
    if (f[1] === '位置') cur.where = f[2]
    else if (f[1] === '现象') cur.what = f[2]
    else if (f[1] === '建议') cur.suggest = f[2]
    else if (f[1] === '关联档案') cur.target = f[2]
  }
  if (cur) items.push(cur)
  return { summary, items: items.filter((it) => it.where !== '' || it.what !== '') }
}
