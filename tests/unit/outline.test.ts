import { describe, expect, it } from 'vitest'
import { isOutlineCardRel, outlineCardDoc, outlineIndexDoc, parseOutlineCard } from '../../src/shared/outline'
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
