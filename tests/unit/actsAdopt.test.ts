import { describe, expect, it } from 'vitest'
import { extractActsBody, adoptActsChapter } from '../../src/shared/actsAdopt'

const draft = [
  '---',
  '章号: 2',
  '题名: 灯下',
  '切片: 第一幕_夜',
  '涉及人物: [陈默, 林晓]',
  '状态: 分幕草稿',
  '---',
  '# 灯下（分幕草稿）',
  '',
  '> 由「分幕生成」按导演板情绪弧分段逐段写出。确认后把下面的正文部分搬进正文文件即可。',
  '',
  '第一段正文：灯下的路忽明忽暗，林晓的脚步跟着那盏灯一起晃。',
  '',
  '第二段正文：两人在暗处并肩站住，谁也没有先开口。',
  ''
].join('\n')

const chapter = [
  '---',
  '章号: 2',
  '题名: 灯下',
  '切片: 第一幕_夜',
  '涉及人物: [陈默, 林晓]',
  '---',
  '# 灯下',
  '',
  '（旧正文，将被草稿替换）',
  ''
].join('\n')

describe('extractActsBody', () => {
  it('剥约定头、草稿题名行与来源注记，只留正文段', () => {
    const body = extractActsBody(draft)
    expect(body).not.toContain('章号')
    expect(body).not.toContain('分幕草稿）')
    expect(body).not.toContain('由「分幕生成」')
    expect(body).toContain('第一段正文')
    expect(body).toContain('第二段正文')
  })

  it('正文自身的 > 引用（如下水道的对话）不会被误删', () => {
    const d = draft + '> “你别过来。”林晓退了一步。\n'
    const body = extractActsBody(d)
    expect(body).toContain('“你别过来。”')
  })

  it('草稿没写正文时返回空串', () => {
    expect(extractActsBody('---\n状态: 分幕草稿\n---\n\n# 灯下（分幕草稿）\n')).toBe('')
  })
})

describe('adoptActsChapter', () => {
  it('保留本章约定头与题名，正文换成草稿段，且不含“状态: 分幕草稿”', () => {
    const r = adoptActsChapter(chapter, draft, '灯下')
    expect('error' in r).toBe(false)
    const { next } = r as { next: string; body: string }
    expect(next).toContain('章号: 2')
    expect(next).toContain('涉及人物: [陈默, 林晓]')
    expect(next).not.toContain('分幕草稿')
    expect(next).not.toContain('（旧正文')
    expect(next).toContain('第一段正文')
    expect(next).toContain('# 灯下')
  })

  it('本章无约定头时退化为“题名＋正文”', () => {
    const r = adoptActsChapter('随便写的旧正文', draft, '无头章')
    expect('error' in r).toBe(false)
    expect((r as { next: string }).next.startsWith('# 无头章')).toBe(true)
  })

  it('草稿无正文时报错', () => {
    const r = adoptActsChapter(chapter, '---\n状态: 分幕草稿\n---\n', '灯下')
    expect('error' in r).toBe(true)
  })
})
