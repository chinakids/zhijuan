import { describe, expect, it } from 'vitest'
import { parseAtRefs, REF_CAP } from '../../src/shared/atRefs'
import { parseAtRefs as parseAtRefsMain } from '../../src/main/agent/refs'

describe('shared/atRefs（main/renderer 同口径）', () => {
  it('REF_CAP 预算常量：单条 4000、合计 12000', () => {
    expect(REF_CAP).toEqual({ each: 4000, total: 12000 })
  })

  it('解析结果与 main/agent/refs 完全一致（同一实现）', () => {
    const text = '看看〔人物·林晓｜人物/林晓.md〕与〔章·雾｜正文/雾.md〕'
    expect(parseAtRefs(text)).toEqual(parseAtRefsMain(text))
  })

  it('无引用 / 残缺形态不误提取', () => {
    expect(parseAtRefs('没有引用')).toEqual([])
    expect(parseAtRefs('【人物·林晓｜人物/林晓.md】')).toEqual([])
  })

  it('引用数量供渲染层估算注入预算：3 条 → min(3×4000, 12000)=12000', () => {
    const refs = parseAtRefs('〔人物·a｜人物/a.md〕〔人物·b｜人物/b.md〕〔人物·c｜人物/c.md〕')
    expect(refs.length).toBe(3)
    expect(Math.min(refs.length * REF_CAP.each, REF_CAP.total)).toBe(12000)
  })
})
