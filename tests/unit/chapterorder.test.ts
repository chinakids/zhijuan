import { describe, expect, it } from 'vitest'
import { chapterOrderCheck, cnToInt, sliceOrdinal } from '../../src/shared/chapterorder'

const body = '正文内容。\n'

const ch = (file: string, no: number | null, slice: string, time?: string, line?: string): { file: string; raw: string } => {
  const head: string[] = []
  if (file) head.push(`题名: ${file.replace(/\.md$/, '')}`)
  if (no !== null) head.push(`章号: ${no}`)
  if (slice !== null) head.push(`切片: ${slice}`)
  if (time !== undefined) head.push(`时间: ${time}`)
  if (line !== undefined) head.push(`时间线: ${line}`)
  return { file, raw: `---\n${head.join('\n')}\n---\n` + body }
}

describe('cnToInt（中文数字解析）', () => {
  it('常规中文/阿拉伯数字', () => {
    expect(cnToInt('一')).toBe(1)
    expect(cnToInt('二')).toBe(2)
    expect(cnToInt('两')).toBe(2)
    expect(cnToInt('十')).toBe(10)
    expect(cnToInt('十二')).toBe(12)
    expect(cnToInt('二十')).toBe(20)
    expect(cnToInt('二十一')).toBe(21)
    expect(cnToInt('百')).toBe(100)
    expect(cnToInt('一百')).toBe(100)
    expect(cnToInt('一百零五')).toBe(105)
    expect(cnToInt('10')).toBe(10)
    expect(cnToInt('007')).toBe(7)
  })
  it('解析不了返回 null', () => {
    expect(cnToInt('甲乙')).toBeNull()
    expect(cnToInt('')).toBeNull()
    expect(cnToInt('一百零甲乙')).toBeNull() // 个位非常规写法，保守跳过
  })
})

describe('sliceOrdinal（切片名「第X」序号）', () => {
  it('识别中文/阿拉伯编号', () => {
    expect(sliceOrdinal('第一幕_夜')).toBe(1)
    expect(sliceOrdinal('第2夜')).toBe(2)
    expect(sliceOrdinal('第二季_第3集')).toBe(2) // 取第一个「第X」
    expect(sliceOrdinal('第十二天')).toBe(12)
  })
  it('无编号返回 null', () => {
    expect(sliceOrdinal('台风夜')).toBeNull()
    expect(sliceOrdinal('')).toBeNull()
  })
})

describe('chapterOrderCheck（切片时序核查纯函数）', () => {
  it('结构完整、顺序正常 → 无条目', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_雾港.md', 1, '第一幕_夜'),
        ch('正文/第02章_灯下.md', 2, '第一幕_夜'),
        ch('正文/第03章_黎明.md', 3, '第二幕_晨')
      ]
    })
    expect(r.items).toEqual([])
    expect(r.summary).toContain('共 3 章，0 条需复核')
  })

  it('R1 约定头缺章号（文件名有编号）→ medium', () => {
    const r = chapterOrderCheck({ chapters: [ch('正文/第07章_无头.md', null, '第一幕_夜')] })
    expect(r.items.length).toBe(1)
    expect(r.items[0].severity).toBe('medium')
    expect(r.items[0].what).toContain('「章号」缺失')
    expect(r.items[0].suggest).toContain('章号: 7')
  })

  it('R2 约定头章号与文件名编号不一致 → medium', () => {
    const r = chapterOrderCheck({ chapters: [ch('正文/第03章_雾港.md', 4, '第一幕_夜')] })
    expect(r.items[0].severity).toBe('medium')
    expect(r.items[0].what).toContain('3')
    expect(r.items[0].what).toContain('4')
  })

  it('R3 章号重复 → medium', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_甲.md', 1, '第一幕'),
        ch('正文/第02章_乙.md', 1, '第一幕')
      ]
    })
    const dup = r.items.filter((i) => i.what.includes('共用'))
    expect(dup.length).toBe(1)
    expect(dup[0].severity).toBe('medium')
  })

  it('R4 章号跳号 → low（且不是错误）', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_甲.md', 1, '第一幕'),
        ch('正文/第03章_乙.md', 3, '第一幕')
      ]
    })
    const gap = r.items.find((i) => i.what.includes('空缺') || i.what.includes('不连续'))
    expect(gap).toBeDefined()
    expect(gap!.severity).toBe('low')
  })

  it('R5 切片序号倒流 → medium', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_甲.md', 1, '第二幕_风起'),
        ch('正文/第02章_乙.md', 2, '第一幕_夜')
      ]
    })
    const flow = r.items.find((i) => i.what.includes('倒流'))
    expect(flow).toBeDefined()
    expect(flow!.severity).toBe('medium')
    expect(flow!.where).toContain('第01章')
  })

  it('R5 无序号的切片名跳过顺序比较', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_甲.md', 1, '台风夜'),
        ch('正文/第02章_乙.md', 2, '暴雨夜')
      ]
    })
    expect(r.items.filter((i) => i.what.includes('倒流'))).toEqual([])
  })

  it('R6 同一切片名被不连续章号共用 → low；连续共用不报', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_甲.md', 1, '第一幕_夜'),
        ch('正文/第03章_乙.md', 3, '第二幕_晨'),
        ch('正文/第05章_丙.md', 5, '第一幕_夜')
      ]
    })
    const shared = r.items.filter((i) => i.where.includes('共用'))
    expect(shared.length).toBe(1)
    expect(shared[0].severity).toBe('low')

    const ok = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_甲.md', 1, '第一幕_夜'),
        ch('正文/第02章_乙.md', 2, '第一幕_夜'),
        ch('正文/第03章_丙.md', 3, '第二幕_晨')
      ]
    })
    expect(ok.items.filter((i) => i.where.includes('共用'))).toEqual([])
  })

  it('空章节 → 提示无正文章，无条目', () => {
    const r = chapterOrderCheck({ chapters: [] })
    expect(r.items).toEqual([])
    expect(r.summary).toContain('还没有正文章节')
  })

  it('多线交错不误报：各线内切片序号各自升序（全局看会误报倒流 → 线内零命中）', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_主线.md', 1, '第一幕_夜', undefined, '主线'),
        ch('正文/第02章_主线.md', 2, '第四幕_灯火', undefined, '主线'),
        ch('正文/第03章_过去线.md', 3, '第二幕_旧港', undefined, '过去线'),
        ch('正文/第04章_过去线.md', 4, '第三幕_渔火', undefined, '过去线')
      ]
    })
    expect(r.items.filter((i) => i.what.includes('倒流'))).toEqual([])
    expect(r.items.filter((i) => i.where.includes('共用'))).toEqual([])
  })

  it('线内倒流仍报：过去线 第三幕(3)→第二幕(2) 命中 1 条', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_主线.md', 1, '第一幕_夜', undefined, '主线'),
        ch('正文/第02章_主线.md', 2, '第四幕_灯', undefined, '主线'),
        ch('正文/第03章_过去线.md', 3, '第三幕_港', undefined, '过去线'),
        ch('正文/第04章_过去线.md', 4, '第二幕_雨', undefined, '过去线')
      ]
    })
    const flow = r.items.filter((i) => i.what.includes('倒流'))
    expect(flow.length).toBe(1)
    expect(flow[0].where).toContain('第03章_过去线.md')
    expect(flow[0].where).toContain('第04章_过去线.md')
    expect(flow[0].severity).toBe('medium')
  })

  it('R6 同线内不连续共用才报；跨线同名不算 R6（R7 提示）', () => {
    const r = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_主线.md', 1, '晨雾', undefined, '主线'),
        ch('正文/第03章_主线.md', 3, '晨雾', undefined, '主线'),
        ch('正文/第02章_过去线.md', 2, '晨雾', undefined, '过去线')
      ]
    })
    const shared = r.items.filter((i) => i.where.includes('共用'))
    expect(shared.length).toBe(1) // 仅主线 1、3 章不连续 → 一条 R6
    expect(shared[0].where).toContain('第 1、3 章')
    const cross = r.items.filter((i) => i.where.includes('条时间线'))
    expect(cross.length).toBe(1) // R7：切片「晨雾」出现在 2 条时间线
    expect(cross[0].severity).toBe('low')
    expect(cross[0].what).toContain('全局唯一')
  })

  it('R7 跨线同名提示列出各线与章号；单线项目零 R7', () => {
    const multi = chapterOrderCheck({
      chapters: [
        ch('正文/第01章_主线.md', 1, '末幕_归途', undefined, '主线'),
        ch('正文/第06章_过去线.md', 6, '末幕_归途', undefined, '过去线')
      ]
    })
    const cross = multi.items.filter((i) => i.where.includes('条时间线'))
    expect(cross.length).toBe(1)
    expect(cross[0].where).toContain('「主线」')
    expect(cross[0].where).toContain('「过去线」')
    const single = chapterOrderCheck({
      chapters: [ch('正文/第01章_甲.md', 1, '末幕_归途'), ch('正文/第02章_乙.md', 2, '末幕_归途')]
    })
    expect(single.items.filter((i) => i.where.includes('条时间线'))).toEqual([])
  })
})
