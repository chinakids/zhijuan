import { describe, expect, it } from 'vitest'
import { findAnchorLine, normalizeAnchor } from '../../src/shared/anchor'

describe('normalizeAnchor（锚点归一化）', () => {
  it('去行首 # 与空白', () => {
    expect(normalizeAnchor('## 切片：第一幕_夜')).toBe('切片：第一幕_夜')
    expect(normalizeAnchor('###  角色状态  ')).toBe('角色状态')
    expect(normalizeAnchor('#基础档案')).toBe('基础档案')
  })

  it('全角空格归一化并去首尾', () => {
    expect(normalizeAnchor('\u3000切片：A\u3000')).toBe('切片：A')
    expect(normalizeAnchor('切片：\u3000第一幕')).toBe('切片： 第一幕')
  })

  it('空/纯井号返回空串', () => {
    expect(normalizeAnchor('')).toBe('')
    expect(normalizeAnchor('###')).toBe('')
  })
})

describe('findAnchorLine（标题节精确定位）', () => {
  const doc = ['# 人物档', '', '## 基础档案', '', '内容', '', '## 切片：第一幕_夜雨', '', '雨夜内容', '', '### 子节', 'x']

  it('归一化后逐字符相等才命中，返回标题行号与级别', () => {
    const h = findAnchorLine(doc, '切片：第一幕_夜雨')
    expect(h).toEqual({ line: 6, level: 2 })
    const h6 = findAnchorLine(['###### 深节', 'y'], '深节')
    expect(h6).toEqual({ line: 0, level: 6 })
  })

  it('前缀相似不命中：夜 ≠ 夜雨（防整节误替换）', () => {
    expect(findAnchorLine(doc, '切片：第一幕_夜')).toBeNull()
  })

  it('正文段落里出现锚点文字不算标题命中', () => {
    expect(findAnchorLine(['这是正文：切片：第一幕_夜雨。', '## 别的'], '切片：第一幕_夜雨')).toBeNull()
  })

  it('标题带尾随空格也能命中（归一化）', () => {
    expect(findAnchorLine(['## 切片：第一幕_夜 ', 'b'], '切片：第一幕_夜')).toEqual({ line: 0, level: 2 })
    expect(findAnchorLine(['## 切片：第一幕_夜'], '##  切片：第一幕_夜')).toEqual({ line: 0, level: 2 })
  })

  it('同名标题多个 → 返回第一个', () => {
    expect(findAnchorLine(['## A', '1', '## A', '2'], 'A')?.line).toBe(0)
  })

  it('锚点为空白/不存在 → null', () => {
    expect(findAnchorLine(doc, '')).toBeNull()
    expect(findAnchorLine(doc, '不存在的节')).toBeNull()
  })
})
