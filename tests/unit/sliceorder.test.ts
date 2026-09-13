import { describe, expect, it } from 'vitest'
import { sliceSectionOrderCheck } from '../../src/shared/sliceorder'

const ch = (file: string, slice: string, no?: number): { file: string; raw: string } => ({
  file,
  raw: `---\n章号: ${no}\n切片: ${slice}\n题名: 测试\n---\n正文。`
})

const person = (file: string, secs: string[]): { file: string; raw: string } => ({
  file,
  raw: `# 林西\n\n> 基础设定\n\n${secs.map((s) => `## 切片：${s}\n\n${s} 的状态。`).join('\n\n')}`
})

describe('sliceSectionOrderCheck（档案切片核查纯函数）', () => {
  it('小节顺序与章序一致 → 零命中且有 summary', () => {
    const r = sliceSectionOrderCheck({
      characters: [person('人物/林西.md', ['第二夜', '第五夜'])],
      chapters: [ch('正文/第02章_夜.md', '第二夜', 2), ch('正文/第05章_归.md', '第五夜', 5)]
    })
    expect(r.items).toEqual([])
    expect(r.summary).toContain('共扫描 1 个人物档案')
    expect(r.summary).toContain('0 条需复核')
  })

  it('倒挂：先写后章再补前章（第五夜小节在第二夜之前）→ medium 命中并给出重排建议', () => {
    const r = sliceSectionOrderCheck({
      characters: [person('人物/林西.md', ['第五夜', '第二夜'])],
      chapters: [
        ch('正文/第02章_夜.md', '第二夜', 2),
        ch('正文/第05章_归.md', '第五夜', 5)
      ]
    })
    expect(r.items.length).toBe(1)
    const it0 = r.items[0]
    expect(it0.severity).toBe('medium')
    expect(it0.type).toBe('timeline')
    expect(it0.where).toBe('人物/林西.md')
    expect(it0.what).toContain('切片：第五夜')
    expect(it0.what).toContain('第 5 章')
    expect(it0.what).toContain('第 2 章')
    expect(it0.suggest).toContain('重排')
  })

  it('同名切片小节重复 → medium 命中（同步残留）', () => {
    const r = sliceSectionOrderCheck({
      characters: [person('人物/林西.md', ['第二夜', '第五夜', '第二夜'])],
      chapters: [ch('正文/第02章_夜.md', '第二夜', 2), ch('正文/第05章_归.md', '第五夜', 5)]
    })
    const dup = r.items.filter((i) => i.type === 'structure')
    expect(dup.length).toBe(1)
    expect(dup[0].severity).toBe('medium')
    expect(dup[0].what).toContain('出现 2 次')
    expect(dup[0].suggest).toContain('删除其余同名小节')
    // 重复不影响顺序检查本身
    const order = r.items.filter((i) => i.type === 'timeline')
    expect(order.length).toBe(1) // 第二夜(后)no2 < 第五夜(前)no5 → 仍命中一条
  })

  it('全卷不存在的切片小节 → low 残留命中', () => {
    const r = sliceSectionOrderCheck({
      characters: [person('人物/林西.md', ['第二夜', '第七夜'])],
      chapters: [ch('正文/第02章_夜.md', '第二夜', 2)]
    })
    const lone = r.items.filter((i) => i.type === 'setting')
    expect(lone.length).toBe(1)
    expect(lone[0].severity).toBe('low')
    expect(lone[0].what).toContain('第七夜')
    expect(lone[0].what).toContain('没有任何章节使用')
  })

  it('同一「切片」被多章共用（闪回/双线）不误报顺序', () => {
    const r = sliceSectionOrderCheck({
      characters: [person('人物/林西.md', ['序幕_灯塔'])],
      chapters: [
        ch('正文/第01章_开.md', '序幕_灯塔', 1),
        ch('正文/第03章_回.md', '序幕_灯塔', 3)
      ]
    })
    expect(r.items).toEqual([])
  })

  it('切片对应章号无法解析（无约定头+文件名无编号）→ 不算残留、跳过顺序比较不误报', () => {
    const r = sliceSectionOrderCheck({
      characters: [person('人物/林西.md', ['第二夜', '第五夜'])],
      chapters: [
        { file: '正文/夜.md', raw: '---\n切片: 第二夜\n---\n正文。' },
        { file: '正文/归.md', raw: '---\n切片: 第五夜\n---\n正文。' }
      ]
    })
    expect(r.items).toEqual([])
  })

  it('无人物档案 → 空态 summary', () => {
    const r = sliceSectionOrderCheck({ characters: [], chapters: [ch('正文/第01章_开.md', '第二夜', 1)] })
    expect(r.items).toEqual([])
    expect(r.summary).toContain('还没有人物档案')
  })

  it('人物档没有切片小节 → 不计数零命中', () => {
    const r = sliceSectionOrderCheck({
      characters: [{ file: '人物/林西.md', raw: '# 林西\n\n> 只有基础设定，没写过切片状态。\n' }],
      chapters: [ch('正文/第01章_开.md', '第二夜', 1)]
    })
    expect(r.items).toEqual([])
    expect(r.summary).toContain('都没有「切片」小节')
  })
})
