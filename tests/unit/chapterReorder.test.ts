import { describe, expect, it } from 'vitest'
import { chapterFileNum, reorderPlan, type ReorderEntry } from '../../src/shared/chapterReorder'

const list: ReorderEntry[] = [
  { file: '第01章_开场.md', title: '开场' },
  { file: '第02章_发展.md', title: '发展' },
  { file: '第03章_高潮.md', title: '高潮' }
]

describe('reorderPlan（章节重排：与相邻章交换章号——文件名前缀 + 约定头）', () => {
  it('中间章上移：与前一章交换章号/文件名', () => {
    const r = reorderPlan(list, '第02章_发展.md', -1)
    expect(r).toEqual({
      ok: true,
      a: '第02章_发展.md',
      b: '第01章_开场.md',
      aNum: 1,
      bNum: 2,
      aNew: '第01章_发展.md',
      bNew: '第02章_开场.md'
    })
  })

  it('中间章下移：与后一章交换', () => {
    const r = reorderPlan(list, '第02章_发展.md', 1)
    expect(r.ok && r.aNew === '第03章_发展.md' && r.bNew === '第02章_高潮.md').toBe(true)
  })

  it('第一章上移：边界错误', () => {
    expect(reorderPlan(list, '第01章_开场.md', -1)).toEqual({ ok: false, error: '已是第一章' })
  })

  it('最后一章下移：边界错误', () => {
    expect(reorderPlan(list, '第03章_高潮.md', 1)).toEqual({ ok: false, error: '已是最后一章' })
  })

  it('未找到当前章：章节不存在', () => {
    expect(reorderPlan(list, '第99章_不存在.md', 1)).toEqual({ ok: false, error: '章节不存在' })
  })

  it('章号 >99：不截断（padStart(2) 只保底）', () => {
    const big = [
      { file: '第09章_前.md', title: '前' },
      { file: '第100章_后.md', title: '后' },
      { file: '第101章_尾.md', title: '尾' }
    ]
    const r = reorderPlan(big, '第09章_前.md', 1)
    expect(r.ok && r.aNew === '第100章_前.md' && r.bNew === '第09章_后.md').toBe(true)
  })

  it('文件名非规范（无第N章前缀）：明确报错指引重命名', () => {
    const bad = [{ file: '雾港.md', title: '雾港' }, { file: '第02章_灯塔.md', title: '灯塔' }]
    expect(reorderPlan(bad, '雾港.md', 1)).toEqual({
      ok: false,
      error: '章节文件名缺少「第N章」编号，请先重命名规范化'
    })
  })

  it('章号重复：报错（不静默交换）', () => {
    const dup = [{ file: '第01章_甲.md', title: '甲' }, { file: '第01章_乙.md', title: '乙' }]
    const r = reorderPlan(dup, '第01章_甲.md', 1)
    expect(r.ok).toBe(false)
  })

  it('无下划线后缀的规范前名：用题名补生成', () => {
    // title 兜底仅当文件名全局无「_」；目录结构里 chapterNewBase 语义同源
    const r = reorderPlan(
      [{ file: '第01章.md', title: '散章甲' }, { file: '第02章.md', title: '散章乙' }],
      '第01章.md',
      1
    )
    expect(r.ok && r.aNew === '第02章_散章甲.md' && r.bNew === '第01章_散章乙.md').toBe(true)
  })

  it('非法方向：无效方向', () => {
    expect(reorderPlan(list, '第02章_发展.md', 0)).toEqual({ ok: false, error: '无效方向' })
  })

  it('单章：任何方向都边界', () => {
    expect(reorderPlan([list[0]], '第01章_开场.md', -1)).toEqual({ ok: false, error: '已是第一章' })
    expect(reorderPlan([list[0]], '第01章_开场.md', 1)).toEqual({ ok: false, error: '已是最后一章' })
  })
})

describe('chapterFileNum（文件名章号解析）', () => {
  it('标准名解析', () => {
    expect(chapterFileNum('第05章_雾港.md')).toBe(5)
  })
  it('多位数解析', () => {
    expect(chapterFileNum('第12章_X.md')).toBe(12)
  })
  it('非规范名返回 null', () => {
    expect(chapterFileNum('雾港.md')).toBeNull()
    expect(chapterFileNum('乱序_第3章.md')).toBeNull()
  })
})
