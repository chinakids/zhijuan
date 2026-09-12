import { describe, expect, it } from 'vitest'
import { actPlaceholder, matchActPlaceholders } from '../../src/shared/actsSeg'

describe('matchActPlaceholders（缺段占位识别）', () => {
  it('空文本 / 无占位正文 → 空数组', () => {
    expect(matchActPlaceholders('')).toEqual([])
    expect(matchActPlaceholders('正文第一段。\n\n正文第二段。')).toEqual([])
  })

  it('单个占位注释 → 返回对应段号', () => {
    expect(matchActPlaceholders('正文。' + actPlaceholder(3) + '正文。')).toEqual([3])
  })

  it('多个占位注释 → 升序去重', () => {
    const t = [actPlaceholder(2), actPlaceholder(5), actPlaceholder(2)].join('\n')
    expect(matchActPlaceholders(t)).toEqual([2, 5])
  })

  it('作者自定义注释不算缺段占位（不误伤）', () => {
    const t = '正文。<!-- 作者备忘：这里要改 --><!-- 待办 -->正文。'
    expect(matchActPlaceholders(t)).toEqual([])
  })

  it('未闭合的 <!-- 原样保留不识别（与 stripHtmlComments 口径一致）', () => {
    const t = '正文。<!-- 分幕草稿缺第 3 段：此处情节未写成，待补齐（手误没闭合）'
    expect(matchActPlaceholders(t)).toEqual([])
  })

  it('actPlaceholder 生成格式与识别函数往返一致', () => {
    expect(matchActPlaceholders(actPlaceholder(7))).toEqual([7])
  })

  it('混合正文与多个占位：只提取段号，不影响正文识别', () => {
    const t = '第一段。\n\n' + actPlaceholder(2) + '\n\n第三段。\n\n' + actPlaceholder(4) + '\n\n第五段。'
    expect(matchActPlaceholders(t)).toEqual([2, 4])
  })
})
