import { describe, expect, it } from 'vitest'
import { isOutlineCardRel, outlineCardDoc, outlineIndexDoc, parseOutlineCard, syncChapterNameInDoc, syncChapterSliceInDoc } from '../../src/shared/outline'
import type { OutlineCard } from '../../src/shared/types'

const card = (n: number, title: string): OutlineCard => ({
  file: `正文/第0${n}章_${title}.md`,
  no: n,
  title,
  slice: '第一幕',
  oneLine: `定位${n}`,
  beats: [`事件${n}`],
  charProgress: `进展${n}`,
  hooks: [`钩${n}`],
  wordCount: 100
})

describe('shared/outline · 章卡文件判据', () => {
  it('只认章卡文件：索引/导演板/分幕/审读 均为副产物', () => {
    expect(isOutlineCardRel('大纲/第01章_雾港.md')).toBe(true)
    expect(isOutlineCardRel('第01章_雾港.md')).toBe(true) // 相对大纲目录口径
    expect(isOutlineCardRel('大纲/索引.md')).toBe(false)
    expect(isOutlineCardRel('大纲/第01章_雾港_导演.md')).toBe(false)
    expect(isOutlineCardRel('大纲/第02章_灯下_分幕.md')).toBe(false)
    expect(isOutlineCardRel('大纲/审读_一致性巡查.md')).toBe(false)
    expect(isOutlineCardRel('大纲/.DS_Store.md')).toBe(false)
  })
})

describe('shared/outline · 章卡生成与回读', () => {
  it('outlineCardDoc 产约定头+标准小节；parseOutlineCard 原样回读', () => {
    const doc = outlineCardDoc(card(1, '雾港'), '正文/第01章_雾港.md')
    expect(doc).toContain('章号: 1')
    expect(doc).toContain('题名: 雾港')
    expect(doc).toContain('切片: 第一幕')
    expect(doc).toContain('> 对应正文：正文/第01章_雾港.md')
    expect(doc).toContain('## 一句话定位')
    expect(doc).toContain('- 事件1')
    const back = parseOutlineCard(doc, '大纲/第01章_雾港.md')
    expect(back).not.toBeNull()
    expect(back).toMatchObject({
      file: '正文/第01章_雾港.md',
      no: 1,
      title: '雾港',
      slice: '第一幕',
      oneLine: '定位1',
      beats: ['事件1'],
      charProgress: '进展1',
      hooks: ['钩1']
    })
  })

  it('空文本 → null；无约定头的章卡也能兜底解析（file 从 对应正文 行取）', () => {
    expect(parseOutlineCard('', '大纲/第01章_雾港.md')).toBeNull()
    const loose = parseOutlineCard('# 章卡\n\n> 对应正文：正文/第01章_雾港.md\n', '大纲/第01章_雾港.md')
    expect(loose).not.toBeNull()
    expect(loose?.file).toBe('正文/第01章_雾港.md')
    expect(loose?.no).toBeUndefined()
  })
})

describe('shared/outline · 重命名章时同步副产物内容', () => {
  it('章卡：fm 题名/H1 标题/对应正文行同步，其余小节与手工补充行原样保留', () => {
    const doc = outlineCardDoc(card(1, '雾港'), '正文/第01章_雾港.md') + '- 手工补充：旧题名在正文里也可出现（不该被动）\n'
    const next = syncChapterNameInDoc(doc, '雾港', '灯下雾', '正文/第01章_灯下雾.md')
    expect(next).toContain('题名: 灯下雾')
    expect(next).toContain('# 章卡 第1章 灯下雾')
    expect(next).toContain('> 对应正文：正文/第01章_灯下雾.md')
    expect(next).not.toContain('# 章卡 第1章 雾港')
    expect(next).not.toContain('> 对应正文：正文/第01章_雾港.md')
    // 其余内容保留：小节正文、手工补充行（含旧题名）不动
    expect(next).toContain('定位1')
    expect(next).toContain('- 事件1')
    expect(next).toContain('- 手工补充：旧题名在正文里也可出现（不该被动）')
  })

  it('导演板：fm 题名与「# 导演板 · 第N章」标题同步，正文细节不动', () => {
    const raw = [
      '---', '章号: 1', '题名: 雾港', '切片: 第一幕', '状态: 已生成', '---', '',
      '# 导演板 · 第1章 雾港', '', '> 对应正文：正文/第01章_雾港.md', '',
      '## 情绪弧分段', '', '1. **推进**：雾港的灯把裂缝松动', ''
    ].join('\n')
    const next = syncChapterNameInDoc(raw, '雾港', '灯下雾', '正文/第01章_灯下雾.md')
    expect(next).toContain('题名: 灯下雾')
    expect(next).toContain('# 导演板 · 第1章 灯下雾')
    expect(next).toContain('> 对应正文：正文/第01章_灯下雾.md')
    expect(next).toContain('1. **推进**：雾港的灯把裂缝松动') // 小节里的旧题名不动
    expect(next).not.toContain('# 导演板 · 第1章 雾港')
  })

  it('幂等/handling：旧题名为空只改对应行；H1 不含旧题名则只改 fm 与对应行；无约定头原样（除对应行）', () => {
    // 旧题名为空：H1 判定跳过，仅 fm(无则无) 与对应行更新
    const a = syncChapterNameInDoc('# 章卡\n\n> 对应正文：正文/第01章_雾港.md\n', '', '灯下雾', '正文/第01章_灯下雾.md')
    expect(a).toContain('> 对应正文：正文/第01章_灯下雾.md')
    expect(a).not.toContain('题名: 灯下雾') // 无 fm 不新增（setFrontMatterField 语义：无约定头原样返回）
    // H1 不含旧题名（用户手改过标题）：H1 不动，fm 与对应行仍更新
    const b = syncChapterNameInDoc(
      ['---', '题名: 雾港', '---', '', '# 自定义标题', '', '> 对应正文：正文/第01章_雾港.md', ''].join('\n'),
      '雾港', '灯下雾', '正文/第01章_灯下雾.md'
    )
    expect(b).toContain('题名: 灯下雾')
    expect(b).toContain('# 自定义标题')
    expect(b).toContain('> 对应正文：正文/第01章_灯下雾.md')
  })

  it('防御：旧题名是 H1 内题名的子串时不误伤（「雾」→「雾港」不是「雾港港」）', () => {
    const doc = [
      '---', '题名: 雾港', '---', '', '# 章卡 第1章 雾港', '',
      '> 对应正文：正文/第01章_雾港.md', '', '## 一句话定位', '', '定位', ''
    ].join('\n')
    const next = syncChapterNameInDoc(doc, '雾', '雾港', '正文/第01章_雾港.md')
    expect(next).toContain('# 章卡 第1章 雾港') // H1 不动（行尾是「港」不是「雾」）
    expect(next).toContain('题名: 雾港') // fm 题名照常更新（旧题名「雾」→「雾港」）
    expect(next).not.toContain('雾港港')
  })

  it('新题名为空：原样返回；与旧题名相同：内容无变化', () => {
    const doc = '# 章卡 第1章 雾港\n\n> 对应正文：正文/第01章_雾港.md\n'
    expect(syncChapterNameInDoc(doc, '雾港', '', '正文/第01章_雾港.md')).toBe(doc)
    expect(syncChapterNameInDoc(doc, '雾港', '雾港', '正文/第01章_雾港.md')).toBe(doc)
  })
})

describe('shared/outline · 切片名修改时同步副产物 fm「切片」字段', () => {
  it('有约定头：仅改「切片」值，H1/对应正文行/小节内容全部不动', () => {
    const doc = [
      '---', '章号: 1', '题名: 雾港', '切片: 第一幕', '状态: 已回建', '---', '',
      '# 章卡 第1章 雾港', '', '> 对应正文：正文/第01章_雾港.md', '',
      '## 一句话定位', '', '定位1', ''
    ].join('\n')
    const next = syncChapterSliceInDoc(doc, '第一幕_雾港夜')
    expect(next).toContain('切片: 第一幕_雾港夜')
    expect(next).not.toContain('切片: 第一幕\n')
    expect(next).toContain('# 章卡 第1章 雾港')
    expect(next).toContain('> 对应正文：正文/第01章_雾港.md')
    expect(next).toContain('定位1')
  })

  it('防御：新切片名为空原样返回；无约定头原样返回；值相同内容不变', () => {
    const doc = '# 只有正文\n'
    expect(syncChapterSliceInDoc(doc, '')).toBe(doc)
    expect(syncChapterSliceInDoc(doc, '第一幕')).toBe(doc)
    const fm = '---\n切片: 第一幕\n---\n\n# 章卡\n'
    expect(syncChapterSliceInDoc(fm, '第一幕')).toBe(fm)
  })
})

describe('shared/outline · 索引生成', () => {
  it('计数 + 逐章块；空列表给空态文案', () => {
    const idx = outlineIndexDoc([card(1, '雾港'), card(2, '灯塔')])
    expect(idx).toContain('共 2 章已回建章卡')
    expect(idx).toContain('## 第1章 · 雾港')
    expect(idx).toContain('## 第2章 · 灯塔')
    expect(idx).toContain('> 定位：定位1')
    expect(outlineIndexDoc([])).toContain('还没有章卡')
  })
})
