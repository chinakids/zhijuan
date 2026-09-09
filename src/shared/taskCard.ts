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
