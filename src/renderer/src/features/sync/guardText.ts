import type { SyncIssue } from '../../../../shared/types'

/** 守卫拦截摘要纯文本（无拦截返回 ''）：用于文本型承载（toast description 等） */
export function guardIssueSummary(issues: SyncIssue[] | undefined): string {
  if (!issues || !issues.length) return ''
  return `拦截 ${issues.length} 条`
}

/** 守卫拦截明细纯文本（供 toast description 等文本承载；逐条「处置 原target：reason」，每条一行（\n 分隔，配合 toast whitespace-pre-wrap 逐行呈现），无拦截返回 ''） */
export function formatGuardIssuesText(issues: SyncIssue[] | undefined): string {
  if (!issues || !issues.length) return ''
  return issues.map((it) => `${it.action === 'corrected' ? '已纠正' : '已丢弃'} ${it.target}：${it.reason}`).join('\n')
}
