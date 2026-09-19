import { describe, expect, it } from 'vitest'
import { listSliceEntries, orphanWorldFiles, sliceNameOfWorldFile, type SliceSource } from '../../src/shared/slices'

// shared/slices.listSliceEntries：切片枚举纯函数口径（真机 main/slices.listSlices 与 devShim 共用，2026-09-12）
// 锁住老 devShim 手写正则分叉过的点：只认约定头块、支持「时间」字段、无切片字段跳过、按章号数值排序。
const src = (file: string, text: string, updatedAt = 2000): SliceSource => ({ file, text, updatedAt })

const FM1 = ['---', '章号: 2', '题名: 灯塔', '切片: 第二幕_灯塔', '时间: 雾夜', '涉及人物: [阿七]', '---', '', '正文。'].join('\n')

describe('listSliceEntries（与真机 listSlices 同口径）', () => {
  it('解析切片/时间/涉及人物；updatedAt 透传；line 缺省=主线', () => {
    const [s] = listSliceEntries([src('第02章_灯塔.md', FM1, 3000)])
    expect(s).toEqual({
      name: '第二幕_灯塔',
      chapter: '第02章_灯塔',
      line: '主线',
      time: '雾夜',
      chars: ['阿七'],
      updatedAt: 3000
    })
  })

  it('「时间线」字段透传；空白/缺失归一为主线（与 line.chapterLine 同口径）', () => {
    const past = ['---', '章号: 1', '切片: 过去·第三幕', '时间线: 过去线', '---', '', '正文。'].join('\n')
    const blank = ['---', '章号: 2', '切片: 主线幕', '时间线:    ', '---', '', '正文。'].join('\n')
    let out = listSliceEntries([src('第01章_忆.md', past), src('第02章_b.md', blank)])
    expect(out.map((s) => s.line)).toEqual(['过去线', '主线'])
  })

  it('无「时间」字段 → time undefined；无约定头或无可读的切片字段 → 跳过', () => {
    const noTime = ['---', '章号: 1', '切片: 第一幕', '涉及人物: [阿七]', '---', '', '正文。'].join('\n')
    const noSlice = ['---', '章号: 3', '题名: 码头', '---', '', '正文。'].join('\n')
    const out = listSliceEntries([src('第01章_a.md', noTime), src('第03章_b.md', noSlice), src('第04章_c.md', '# 无约定头')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: '第一幕', time: undefined })
  })

  it('排序按章号数值（第2章 在 第10章 前）；同号/解析不出按文件名兜底', () => {
    const mk = (file: string) => src(file, `---\n章号: 9\n切片: S_${file}\n---\n正文。`)
    const out = listSliceEntries([mk('第10章_十.md'), mk('第02章_二.md'), mk('序章.md')])
    expect(out.map((s) => s.chapter)).toEqual(['第02章_二', '第10章_十', '序章'])
  })

  it('涉及人物空数组 → chars=[]（安全取数组）', () => {
    const t = ['---', '章号: 5', '切片: 第五幕', '涉及人物: []', '---', '', '正文。'].join('\n')
    const [s] = listSliceEntries([src('第05章_x.md', t)])
    expect(s.chars).toEqual([])
  })
})

describe('orphanWorldFiles（世界切片孤儿文件判定，2026-09-19 创作层）', () => {
  it('sliceNameOfWorldFile：切片_<名>.md 解析；非切片前缀/无 .md/子目录 返回 null', () => {
    expect(sliceNameOfWorldFile('切片_第二幕_灯塔.md')).toBe('第二幕_灯塔')
    expect(sliceNameOfWorldFile('总纲.md')).toBeNull()
    expect(sliceNameOfWorldFile('灯塔.md')).toBeNull()
    expect(sliceNameOfWorldFile('子目录/切片_第二幕.md')).toBeNull()
  })

  it('孤儿=切片_<名>.md 且 <名> 不在活跃集合；非切片前缀文件一律不算', () => {
    const files = ['总纲.md', '切片_第二幕_灯塔.md', '切片_第一幕_烧杯.md', '灯塔.md', '切片_旧_线.md']
    expect(orphanWorldFiles(files, ['第二幕_灯塔', '旧_线'])).toEqual(['切片_第一幕_烧杯.md'])
    expect(orphanWorldFiles(files, [])).toEqual(['切片_第二幕_灯塔.md', '切片_第一幕_烧杯.md', '切片_旧_线.md'])
    expect(orphanWorldFiles(['总纲.md', '灯塔.md'], [])).toEqual([])
  })

  it('空文件/空活跃集/重复防御', () => {
    expect(orphanWorldFiles([], ['a'])).toEqual([])
    expect(orphanWorldFiles(['切片_a.md'], [])).toEqual(['切片_a.md'])
    // 活跃集合含重名时不算孤儿（Set 语义）
    expect(orphanWorldFiles(['切片_a.md'], ['a', 'a'])).toEqual([])
  })
})
