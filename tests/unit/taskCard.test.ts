import { describe, expect, it } from 'vitest'
import { isLibraryResultPath, isTaskStale, parseTaskCard, rebuildTaskCardForRetry, STALE_TASK_MS } from '../../src/shared/taskCard'

// 样例：与真机管道回填后的任务卡格式一致（素材库验收项目实测）
const DONE_CARD = [
  '---',
  'status: done',
  '需求: 校园图书馆的感官细节，要写实的、贴近国内校园的描写素材',
  '关键词: [旧图书馆, 借书卡, 阅览室, 木质书架]',
  '类别: 环境',
  '来源:',
  '创建: 2026-09-03 00:45',
  '结果: 素材库/环境/采集_先一条试试.md',
  '完成: 2026-09-03 12:25',
  '---',
  '',
  '# 采集任务：校园图书馆场景细节',
  '',
  '用于小说「放学后的图书馆」一段的质感支撑。'
].join('\n')

describe('parseTaskCard', () => {
  it('解析管道回填后的已完成任务卡：状态/类别/关键词/需求/结果/完成/正文', () => {
    const d = parseTaskCard(DONE_CARD)
    expect(d.status).toBe('done')
    expect(d.category).toBe('环境')
    expect(d.keywords).toEqual(['旧图书馆', '借书卡', '阅览室', '木质书架'])
    expect(d.demand).toContain('校园图书馆')
    expect(d.result).toBe('素材库/环境/采集_先一条试试.md')
    expect(d.finishedAt).toBe('2026-09-03 12:25')
    expect(d.source).toBe('')
    expect(d.body).toContain('# 采集任务：校园图书馆场景细节')
    expect(d.body).not.toContain('status:')
  })

  it('解析 pending 任务卡：无结果/完成字段时为空串', () => {
    const d = parseTaskCard(
      ['---', 'status: pending', '类别: 环境', '需求: 找点雨夜的描写', '关键词: [雨, 夜]', '创建: 2026-09-05 10:00', '---', '', '# 采集任务：雨夜'].join('\n')
    )
    expect(d.status).toBe('pending')
    expect(d.result).toBe('')
    expect(d.finishedAt).toBe('')
    expect(d.keywords).toEqual(['雨', '夜'])
  })

  it('无约定头时字段全空、body 为原文（不会崩）', () => {
    const d = parseTaskCard('只有一行文本')
    expect(d.status).toBe('pending')
    expect(d.category).toBe('')
    expect(d.body).toBe('只有一行文本')
  })

  it('未知状态原样保留（如管道扩展了 running）', () => {
    const d = parseTaskCard(['---', 'status: running', '类别: 人物', '---', '', 'x'].join('\n'))
    expect(d.status).toBe('running')
  })
})

describe('rebuildTaskCardForRetry（重发 = 重建全新 pending 卡）', () => {
  it('done 卡重建：status=pending、旧结果/完成被清、需求/关键词/类别/来源/创建保留', () => {
    const d = parseTaskCard(DONE_CARD)
    const next = rebuildTaskCardForRetry(d)
    const r = parseTaskCard(next)
    expect(r.status).toBe('pending')
    expect(r.demand).toBe(d.demand)
    expect(r.keywords).toEqual(d.keywords)
    expect(r.category).toBe(d.category)
    expect(r.createdAt).toBe(d.createdAt)
    expect(r.result).toBe('')
    expect(r.finishedAt).toBe('')
    expect(r.body).toContain('# 采集任务：校园图书馆场景细节')
  })

  it('重建前后 parse 关键字段一致（可逆：重发后仍能再次重发）', () => {
    const d = parseTaskCard(DONE_CARD)
    const once = parseTaskCard(rebuildTaskCardForRetry(d))
    const twice = parseTaskCard(rebuildTaskCardForRetry(once))
    expect(twice.demand).toBe(d.demand)
    expect(twice.keywords).toEqual(d.keywords)
    expect(twice.category).toBe(d.category)
    expect(twice.source).toBe(d.source)
    expect(twice.createdAt).toBe(d.createdAt)
  })

  it('空正文卡重建后仍带标题占位（避免空卡落盘）', () => {
    const d = parseTaskCard(['---', 'status: failed', '需求: 雨夜', '---'].join('\n'))
    const next = rebuildTaskCardForRetry(d)
    expect(next).toContain('采集任务：雨夜')
  })
})

describe('isTaskStale（采集任务停滞判定；阈值 2 天）', () => {
  const now = 1_800_000_000_000
  it('pending 卡 2 天未动：判停滞（超阈值即停滞）', () => {
    expect(isTaskStale('pending', now - STALE_TASK_MS - 1, now)).toBe(true)
  })
  it('恰好等于阈值：不算停滞（宽容边界）', () => {
    expect(isTaskStale('pending', now - STALE_TASK_MS, now)).toBe(false)
  })
  it('刚登记（1 小时 / 1 天）：不算停滞', () => {
    expect(isTaskStale('pending', now - 3_600_000, now)).toBe(false)
    expect(isTaskStale('pending', now - 86_400_000, now)).toBe(false)
  })
  it('终态 done/failed 恒不算停滞（即使 10 天前完成）', () => {
    expect(isTaskStale('done', now - 10 * 86_400_000, now)).toBe(false)
    expect(isTaskStale('failed', now - 10 * 86_400_000, now)).toBe(false)
  })
  it('running 长期不动也算停滞（管道可能死掉没回填）', () => {
    expect(isTaskStale('running', now - 3 * 86_400_000, now)).toBe(true)
  })
  it('未知状态按非终态处理（可能停滞）', () => {
    expect(isTaskStale('queued', now - 3 * 86_400_000, now)).toBe(true)
  })
})

describe('isLibraryResultPath（详情预览结果的安全校验）', () => {
  it('管道正常回填的素材路径：通过', () => {
    expect(isLibraryResultPath('素材库/环境/采集_校园老图书馆.md')).toBe(true)
    expect(isLibraryResultPath('素材库/人物/访谈_陈默.md')).toBe(true)
  })

  it('穿越路径（../）必须挡掉（主进程 readDoc 不防穿越）', () => {
    expect(isLibraryResultPath('素材库/../人物/林晚.md')).toBe(false)
    expect(isLibraryResultPath('../project.json')).toBe(false)
    expect(isLibraryResultPath('素材库/环境/../../project.json.md')).toBe(false)
  })

  it('非素材库前缀 / 非 markdown / 空值：全部挡掉', () => {
    expect(isLibraryResultPath('人物/林晚.md')).toBe(false)
    expect(isLibraryResultPath('素材库/环境/结果.txt')).toBe(false)
    expect(isLibraryResultPath('')).toBe(false)
    expect(isLibraryResultPath('素材库')).toBe(false)
  })
})
