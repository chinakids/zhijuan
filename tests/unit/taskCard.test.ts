import { describe, expect, it } from 'vitest'
import { isLibraryResultPath, isTaskStale, normDemand, parseTaskCard, rebuildTaskCardForRetry, taskCardDoc, taskCardFileName, STALE_TASK_MS } from '../../src/shared/taskCard'

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

describe('taskCardDoc / taskCardFileName / normDemand（2026-09-29 智能层：agent 采集建议落卡模板）', () => {
  it('任务卡文件名符合「任务_<14位时间戳>」约定', () => {
    expect(taskCardFileName(Date.UTC(2026, 8, 29, 1, 2, 3))).toMatch(/^任务_\d{14}$/)
  })

  it('生成的任务卡 front matter 与 parseTaskCard 往返一致（status: pending=管道唯一处理判据）', () => {
    const text = taskCardDoc({
      demand: '九十年代小城火车站候车室的常见陈设与氛围',
      keywords: ['火车站候车室', '九十年代', '候车室陈设'],
      category: '环境',
      note: '第03章雾港线候车室场景需要具体年代细节支撑'
    })
    const d = parseTaskCard(text)
    expect(d.status).toBe('pending')
    expect(d.category).toBe('环境')
    expect(d.keywords).toEqual(['火车站候车室', '九十年代', '候车室陈设'])
    expect(d.demand).toBe('九十年代小城火车站候车室的常见陈设与氛围')
    expect(d.body).toContain('**说明**：第03章雾港线候车室场景需要具体年代细节支撑')
    expect(d.body).not.toContain('status:')
  })

  it('空类别兜底「环境」；换行需求压平；note 可缺省', () => {
    const d = parseTaskCard(taskCardDoc({ demand: '雨夜\n码头', keywords: ['雨', '码头'], category: '' }))
    expect(d.category).toBe('环境')
    expect(d.demand).toBe('雨夜 码头')
    expect(d.body).not.toContain('**说明**')
  })

  it('全空白类别同样兜底「环境」；正文「需求详情」保留原文换行（front matter 才压平）', () => {
    const text = taskCardDoc({ demand: '雨夜\n码头', keywords: ['雨'], category: '   ' })
    const d = parseTaskCard(text)
    expect(d.category).toBe('环境')
    expect(d.demand).toBe('雨夜 码头')
    expect(d.body).toContain('**需求详情**：雨夜\n码头')
  })

  it('ts 透传：创建时间与文件名同源（toLocaleString sv 本地时区）', () => {
    const ts = Date.UTC(2026, 8, 29, 1, 2, 3)
    const d = parseTaskCard(taskCardDoc({ demand: 'x', keywords: [], category: '环境', ts }))
    expect(d.createdAt).toBe(new Date(ts).toLocaleString('sv'))
    expect(taskCardFileName(ts)).toMatch(/^任务_\d{14}$/)
  })

  it('normDemand：去首尾与内部空白（查重同口径）', () => {
    expect(normDemand(' 校园 图书馆 ')).toBe(normDemand('校园图书馆'))
    expect(normDemand('雨夜码头')).not.toBe(normDemand('雨夜'))
  })
})
