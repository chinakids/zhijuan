import { describe, expect, it } from 'vitest'
import { quoteSrcOf } from '../../src/renderer/src/lib/quoteSrc'

describe('quoteSrcOf（划词引用来源显示名）', () => {
  it('正文 → 正文·文件名（去 .md）', () => {
    expect(quoteSrcOf('正文/第02章_灯塔.md')).toBe('正文·第02章_灯塔')
  })
  it('人物 → 人物·名', () => {
    expect(quoteSrcOf('人物/阿七.md')).toBe('人物·阿七')
  })
  it('世界观 → 世界观·名', () => {
    expect(quoteSrcOf('世界观/切片_燃料港.md')).toBe('世界观·切片_燃料港')
  })
  it('素材库两级路径 → 素材·类别/名', () => {
    expect(quoteSrcOf('素材库/港口/船票.md')).toBe('素材·港口/船票')
  })
  it('大纲 → 大纲·名', () => {
    expect(quoteSrcOf('大纲/第01章_雾港.md')).toBe('大纲·第01章_雾港')
  })
  it('未知目录/无前缀 → 原样保底', () => {
    expect(quoteSrcOf('misc/备注.md')).toBe('misc/备注.md')
    expect(quoteSrcOf('裸文件名.md')).toBe('裸文件名.md')
  })
})
