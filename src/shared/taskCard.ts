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
