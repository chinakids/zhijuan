import { describe, expect, it } from 'vitest'
import { QUOTE_CLOSE, QUOTE_OPEN, charAfter, charBefore, quoteStepFor } from '../../src/renderer/src/features/editor/quotePairs'

const OPEN = QUOTE_OPEN
const CLOSE = QUOTE_CLOSE

/** 测试用迷你 doc：textBetween 即字符串切片。 */
function fakeDoc(text: string) {
  return {
    textBetween: (a: number, b: number) => text.slice(a, b),
    content: { size: text.length }
  }
}

describe('quotePairs · quoteStepFor', () => {
  it('输入开引号且后无闭引号 → insert-pair（补全）', () => {
    expect(quoteStepFor(OPEN, '说', null)).toEqual({ type: 'insert-pair' })
    expect(quoteStepFor(OPEN, '说', '你')).toEqual({ type: 'insert-pair' })
  })
  it('输入开引号且后一字符已是闭引号 → insert-open（不重复成对）', () => {
    expect(quoteStepFor(OPEN, '说', CLOSE)).toEqual({ type: 'insert-open' })
  })
  it('输入闭引号且后一字符已是闭引号 → skip-close（跳过不重复）', () => {
    expect(quoteStepFor(CLOSE, '好', CLOSE)).toEqual({ type: 'skip-close' })
  })
  it('输入闭引号但后无闭引号 → none（正常单输）', () => {
    expect(quoteStepFor(CLOSE, '好', null)).toEqual({ type: 'none' })
    expect(quoteStepFor(CLOSE, '好', '，')).toEqual({ type: 'none' })
  })
  it('其它字符一律 none（零干扰）', () => {
    expect(quoteStepFor('他', '说', null)).toEqual({ type: 'none' })
    expect(quoteStepFor('”', null, null)).toEqual({ type: 'none' })
    expect(quoteStepFor('(', '说', null)).toEqual({ type: 'none' })
  })
})

describe('quotePairs · charBefore/charAfter', () => {
  it('charBefore 返回插入点前一字符', () => {
    const doc = fakeDoc('他说“好”')
    expect(charBefore(doc, 3)).toBe(OPEN)
    expect(charBefore(doc, 1)).toBe('他')
  })
  it('charBefore 在文档首返回 null', () => {
    expect(charBefore(fakeDoc('他说'), 0)).toBeNull()
  })
  it('charAfter 返回插入点处字符', () => {
    const doc = fakeDoc('他说“好”')
    expect(charAfter(doc, 2)).toBe(OPEN)
    expect(charAfter(doc, 0)).toBe('他')
  })
  it('charAfter 在文档尾返回 null', () => {
    expect(charAfter(fakeDoc('他说'), 5)).toBeNull()
  })
  it('全角引号按单码元切片（U+201C/U+201D 均 BMP 单码元）', () => {
    const doc = fakeDoc(OPEN + CLOSE)
    expect(doc.textBetween(0, 1)).toBe(OPEN)
    expect(doc.textBetween(1, 2)).toBe(CLOSE)
    expect(charBefore(doc, 1)).toBe(OPEN)
    expect(charAfter(doc, 0)).toBe(OPEN)
  })
})
