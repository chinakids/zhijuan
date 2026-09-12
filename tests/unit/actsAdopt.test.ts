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
  '## 第 1 段',
  '',
  '第一段正文：灯下的路忽明忽暗，林晓的脚步跟着那盏灯一起晃。',
  '',
  '## 第 2 段',
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
  it('剥约定头、草稿题名行、来源注记与「## 第 N 段」标记，只留正文段', () => {
    const body = extractActsBody(draft)
    expect(body).not.toContain('章号')
    expect(body).not.toContain('分幕草稿）')
    expect(body).not.toContain('由「分幕生成」')
    expect(body).not.toContain('## 第 1 段')
    expect(body).not.toContain('## 第 2 段')
    expect(body).toContain('第一段正文')
    expect(body).toContain('第二段正文')
    // 段间仍保留换行分隔，不粘连
    expect(body).toContain('第一段正文：灯下的路忽明忽暗，林晓的脚步跟着那盏灯一起晃。\n\n第二段正文')
  })

  it('缺段警示（> ⚠️ …）不进采纳正文', () => {
    const d = draft.replace('\n> 由「分幕生成」', `\n> 由「分幕生成」\n> ⚠️ 第 2 段未按导演板写成，草稿只含 1/2 段（缺段处情节会断）。请勿直接采纳：先点「补写缺段」只重写失败段，或手动补齐缺段。`)
    const body = extractActsBody(d)
    expect(body).not.toContain('⚠️')
    expect(body).not.toContain('请勿直接采纳')
    expect(body).toContain('第一段正文')
  })

  it('正文自身的 > 引用（如下水道的对话）不会被误删', () => {
    const d = draft + '> “你别过来。”林晓退了一步。\n'
    const body = extractActsBody(d)
    expect(body).toContain('“你别过来。”')
  })

  it('草稿没写正文时返回空串', () => {
    expect(extractActsBody('---\n状态: 分幕草稿\n---\n\n# 灯下（分幕草稿）\n')).toBe('')
  })

  it('缺中间段：占位注释插在下一个成功段标记的位置（正文断链可见）', () => {
    const d = [
      '---', '状态: 分幕草稿', '---', '',
      '# 灯下（分幕草稿）', '',
      '> 由「分幕生成」按导演板情绪弧分段逐段写出。确认后把下面的正文部分搬进正文文件即可。',
      '> ⚠️ 第 2 段未按导演板写成，草稿只含 2/3 段（缺段处情节会断）。请勿直接采纳：先点「补写缺段」只重写失败段，或手动补齐缺段。', '',
      '## 第 1 段', '', '第一段正文。', '',
      '## 第 3 段', '', '第三段正文。', ''
    ].join('\n')
    const body = extractActsBody(d)
    expect(body).toContain('<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->')
    expect(body).toContain('第一段正文。\n\n<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->\n\n第三段正文。')
  })

  it('缺末段：占位注释追加在正文末尾', () => {
    const d = [
      '---', '状态: 分幕草稿', '---', '',
      '# 灯下（分幕草稿）', '',
      '> 由「分幕生成」按导演板情绪弧分段逐段写出。确认后把下面的正文部分搬进正文文件即可。',
      '> ⚠️ 第 2 段未按导演板写成，草稿只含 1/2 段（缺段处情节会断）。请勿直接采纳：先点「补写缺段」只重写失败段，或手动补齐缺段。', '',
      '## 第 1 段', '', '第一段正文。', ''
    ].join('\n')
    const body = extractActsBody(d)
    expect(body).toContain('<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->')
    expect(body.endsWith('第一段正文。\n\n<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->')).toBe(true)
  })

  it('首段失败：占位注释插在首个成功段标记前', () => {
    const d = [
      '---', '状态: 分幕草稿', '---', '',
      '# 灯下（分幕草稿）', '',
      '> 由「分幕生成」按导演板情绪弧分段逐段写出。确认后把下面的正文部分搬进正文文件即可。',
      '> ⚠️ 第 1 段未按导演板写成，草稿只含 2/3 段（缺段处情节会断）。请勿直接采纳：先点「补写缺段」只重写失败段，或手动补齐缺段。', '',
      '## 第 2 段', '', '第二段正文。', ''
    ].join('\n')
    const body = extractActsBody(d)
    expect(body).toContain('<!-- 分幕草稿缺第 1 段：此处情节未写成，待补齐 -->\n\n第二段正文。')
  })

  it('警示与实际段序不符（警示说缺但段实际存在）不插占位——无实际断链', () => {
    const d = draft.replace(
      '\n> 由「分幕生成」',
      '\n> 由「分幕生成」\n> ⚠️ 第 2 段未按导演板写成，草稿只含 1/2 段（缺段处情节会断）。请勿直接采纳：先点「补写缺段」只重写失败段，或手动补齐缺段。'
    )
    const body = extractActsBody(d)
    expect(body).not.toContain('<!--')
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
