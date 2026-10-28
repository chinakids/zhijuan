// ===== 织卷 V2 · 采集任务卡解析（模块设计 §十一 通道约定） =====
// 任务卡 = `素材库/采集池/任务_<ts>.md`，front matter 按 §十一：status / 类别 / 关键词 / 需求 / 来源 / 创建；
// 管道回填后追加 `结果:`（素材路径）与 `完成:`（时间）。本模块只做文本 → 结构化，无 fs 依赖，可单测。

import { extractFrontMatter } from './fmatter'

export interface TaskCardView {
  status: string // pending | running | done | failed | 原文其它值
  category: string
  keywords: string[]
  demand: string
  source: string
  createdAt: string
  result: string // 管道回填的素材路径（无则空）
  finishedAt: string
  body: string // 剥掉约定头的正文（markdown）
}

const str = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '')

/**
 * 结果路径是否安全可预览：必须是以 `素材库/` 开头的相对项目 markdown 路径。
 * 管道按约定回填 `素材库/<类别>/<文件>.md`；这里挡掉穿越（../）/非 markdown/空串等坏值，
 * 避免把「结果」当任意文件读进详情预览（主进程 readDoc 只做 join、不防穿越，此校验是唯一防线）。
 */
export function isLibraryResultPath(p: string): boolean {
  return p.startsWith('素材库/') && p.endsWith('.md') && !p.includes('..')
}

/** 停滞阈值：任务卡最后一次被触碰（mtime）距今超过 2 天仍未终态 → 判停滞。
 * 参照 stale-bot 惯例（以「最后活动时间」为 idle 判据、标记不删除）：管道每 20 分钟应处理一次，
 * 任何管道回写/状态变化都会更新 mtime 重置计时；超 2 天未动 = 管道未处理（停机/失败/被跳过）。 */
export const STALE_TASK_MS = 172_800_000 // 2 天

/** 任务卡是否停滞：status 为终态（done/failed）恒不算；其余（pending/running/未知）按最后活动时间 idle 判定 */
export function isTaskStale(status: string, lastActivityMs: number, nowMs: number): boolean {
  if (status === 'done' || status === 'failed') return false
  return nowMs - lastActivityMs > STALE_TASK_MS
}

/**
 * 重发：用现卡解析字段重建一张全新 pending 卡（清掉旧结果/完成，保留需求/关键词/类别/来源与正文；
 * 创建时间保留原值=首次创建时间戳，与文件名 任务_<ts> 自洽）。纯函数，可单测。
 */
export function rebuildTaskCardForRetry(v: TaskCardView): string {
  const fm = ['---', 'status: pending']
  if (v.category) fm.push('类别: ' + v.category)
  if (v.keywords.length > 0) fm.push('关键词: [' + v.keywords.join(', ') + ']')
  fm.push('需求: ' + v.demand)
  if (v.source) fm.push('来源: ' + v.source)
  if (v.createdAt) fm.push('创建: ' + v.createdAt)
  fm.push('---', '')
  const body = v.body || '# 采集任务：' + v.demand.slice(0, 20)
  return fm.join('\n') + '\n' + body + '\n'
}

/**
 * 编辑并重发：在现卡解析字段基础上，用编辑后的 需求/关键词/类别/来源 重建一张 pending 卡。
 * 保留 创建（首次创建时间戳）与正文 body；清掉 结果/完成（重发=重新采集，管道只认 status: pending）。
 * 与 rebuildTaskCardForRetry 的区别：本函数以编辑字段为准重写四字段，且对 ANY 状态卡都重置为 pending
 * （含 done/failed——作者看到结果不满意、想换个需求重新采集的高频场景），纯函数可单测。
 */
export function rebuildTaskCardForEdit(
  v: TaskCardView,
  opts: { demand: string; keywords: string[]; category: string; source: string }
): string {
  const demand = (opts.demand || '').replace(/\n/g, ' ')
  const kws = (opts.keywords || []).map((s) => s.trim()).filter(Boolean)
  const fm = ['---', 'status: pending']
  if ((opts.category || '').trim()) fm.push('类别: ' + opts.category.trim())
  if (kws.length > 0) fm.push('关键词: [' + kws.join(', ') + ']')
  fm.push('需求: ' + demand)
  if ((opts.source || '').trim()) fm.push('来源: ' + opts.source.trim())
  if (v.createdAt) fm.push('创建: ' + v.createdAt)
  fm.push('---', '')
  const body = v.body || '# 采集任务：' + demand.slice(0, 20)
  return fm.join('\n') + '\n' + body + '\n'
}

/** 任务卡文件名（与「任务_<14位时间戳>.md」约定一致；ts 毫秒时间戳） */
export function taskCardFileName(ts: number): string {
  return '任务_' + new Date(ts).toISOString().replace(/[-:TZ]/g, '').slice(0, 14)
}

/**
 * 新建任务卡文本（模块设计 §十一 通道约定：front matter status: pending / 类别 / 关键词 /
 * 需求 / 来源 / 创建 + 描述正文）。纯函数零 fs，可单测。
 * 2026-09-29 平台层收敛：CollectionBar「发起采集」表单与 CollectCard（agent 建议）共用本函数，
 * 撤除内联旧模板——任务卡模板单一来源，防两处漂移（「类别」trim 兜底、创建时间与文件名同源）。
 */
export function taskCardDoc(opts: {
  demand: string
  keywords: string[]
  category: string
  source?: string
  note?: string
  ts?: number
}): string {
  const raw = opts.demand || ''
  const demand = raw.replace(/\n/g, ' ')
  const kws = (opts.keywords || []).map((s) => s.trim()).filter(Boolean)
  const fm = [
    '---',
    'status: pending',
    '类别: ' + ((opts.category || '').trim() || '环境'),
    '关键词: [' + kws.join(', ') + ']',
    '需求: ' + demand,
    '来源: ' + (opts.source ?? '').trim(),
    '创建: ' + new Date(opts.ts ?? Date.now()).toLocaleString('sv'),
    '---',
    '',
    '# 采集任务：' + demand.slice(0, 20),
    '',
    '**需求详情**：' + raw
  ]
  if (opts.note) fm.push('', '**说明**：' + opts.note.replace(/\n/g, ' '))
  fm.push('', '（由本机采集子 agent 按需求/关键词检索并回填结果；也可在采集栏手动「派发」。）', '')
  return fm.join('\n')
}

// ===== 管道回写：任务卡状态/结果（纯文本操作，主进程采集子 agent 用；可单测） =====
// 回写必须**保留原字段与正文**（作者可能在卡上写说明），只改 status/结果/完成/失败 四行并追加摘要段。
// 这几个函数只做字符串处理，不做 fs——写盘/改 mtime 由调用方（collector）负责。

/** 定位 front matter（保留原文行，便于逐行改写；无约定头返回 null） */
function locateFm(text: string): { lines: string[]; rest: string } | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  return { lines: m[1].split(/\r?\n/), rest: text.slice(m[0].length) }
}

const fmKeyOf = (line: string): string => line.split(':')[0].trim()

/** 设置（或追加）一个约定头字段：同名原地替换，其余字段/正文原样保留。无约定头时补一个最小头。 */
export function setTaskField(text: string, key: string, value: string): string {
  const line = key + ': ' + (value ?? '').replace(/\r?\n/g, ' ')
  const fm = locateFm(text)
  if (!fm) return ['---', line, '---', '', text.replace(/^\s*\n/, '')].join('\n')
  const i = fm.lines.findIndex((l) => fmKeyOf(l) === key)
  if (i >= 0) fm.lines[i] = line
  else fm.lines.push(line)
  return '---\n' + fm.lines.join('\n') + '\n---\n' + fm.rest
}

/** 删除一个约定头字段（无该字段时原样返回） */
export function removeTaskField(text: string, key: string): string {
  const fm = locateFm(text)
  if (!fm) return text
  const lines = fm.lines.filter((l) => fmKeyOf(l) !== key)
  if (lines.length === fm.lines.length) return text
  return '---\n' + lines.join('\n') + '\n---\n' + fm.rest
}

/** 正文追加一段（去尾部空白后空一行接上；块内自带小标题） */
export function appendTaskBody(text: string, block: string): string {
  const b = block.trim()
  if (!b) return text
  return text.replace(/\s+$/, '') + '\n\n' + b + '\n'
}

/** 删掉正文里同名小标题的旧段落（`## 采集摘要` → 到下一个 `## ` 之前），避免重试后摘要/失败原因叠加 */
function stripBodySection(text: string, heading: string): string {
  const i = text.indexOf(heading)
  if (i < 0) return text
  const after = text.slice(i + heading.length)
  const next = after.search(/\n##\s/)
  return (text.slice(0, i) + (next >= 0 ? after.slice(next + 1) : '')).replace(/\s+$/, '') + '\n'
}

/** 置 running（清掉上一轮失败原因） */
export function markTaskRunning(text: string): string {
  return setTaskField(removeTaskField(text, '失败'), 'status', 'running')
}

/** 置 done：status/结果/完成 三行 + 正文追加「采集摘要」（旧的 采集摘要/采集失败 段先清掉） */
export function markTaskDone(text: string, resultRel: string, finishedAt: string, summary?: string): string {
  let out = setTaskField(removeTaskField(text, '失败'), 'status', 'done')
  out = setTaskField(out, '结果', resultRel)
  out = setTaskField(out, '完成', finishedAt)
  out = stripBodySection(out, '## 采集摘要')
  out = stripBodySection(out, '## 采集失败')
  if (summary && summary.trim()) out = appendTaskBody(out, '## 采集摘要\n\n' + summary.trim())
  return out
}

/** 置 failed：status/失败（原因截断到 200 字）+ 正文追加「采集失败」段；结果/完成 保留上一轮以便排查 */
export function markTaskFailed(text: string, reason: string, at: string): string {
  const why = (reason || '未知原因').replace(/\s+/g, ' ').slice(0, 200)
  let out = setTaskField(text, 'status', 'failed')
  out = setTaskField(out, '失败', why)
  out = stripBodySection(out, '## 采集失败')
  out = appendTaskBody(out, '## 采集失败\n\n- 时间：' + at + '\n- 原因：' + why)
  return out
}

/** 任务卡文件名 → 采集会话 id（`任务_20261028123045.md` → `zj-collect-20261028123045`） */
export function taskSessionId(taskRel: string): string {
  const name = taskRel.replace(/^.*\//, '').replace(/\.md$/, '').replace(/^任务_/, '')
  const digits = name.replace(/[^0-9]/g, '')
  const slug = digits || name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'task'
  return 'zj-collect-' + slug
}

/** 需求文本归一（查重用）：去首尾空白与内部空白，避免「校园 图书馆」与「校园图书馆」被判不同 */
export const normDemand = (s: string): string => s.trim().replace(/\s+/g, '')

/** 任务卡文本 → UI 友好的详情结构（无约定头时按空卡处理，字段全空、body=原文） */
export function parseTaskCard(text: string): TaskCardView {
  const { fm, body } = extractFrontMatter(text)
  const key = (k: string): string => str(fm?.[k] ?? '')
  return {
    status: key('status') || 'pending',
    category: key('类别'),
    keywords: Array.isArray(fm?.['关键词']) ? (fm['关键词'] as string[]) : key('关键词').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    demand: key('需求'),
    source: key('来源'),
    createdAt: key('创建'),
    result: key('结果'),
    finishedAt: key('完成'),
    body: body.trim()
  }
}
