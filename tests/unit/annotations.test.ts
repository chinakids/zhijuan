import { describe, it, expect } from 'vitest'
import { parseCsvLine, parseLoc, segmentFromText, parseAnnotationCsv, escapeCsvField } from '../../src/shared/annotations'

describe('批注工具（shared/annotations）', () => {
  it('parseCsvLine：普通两列', () => {
    expect(parseCsvLine('L10:1-L10:20,这句太文艺')).toEqual(['L10:1-L10:20', '这句太文艺'])
  })
  it('parseCsvLine：字段含逗号（引号包裹）与转义引号', () => {
    expect(parseCsvLine('L3:2-L3:9,"改，更""克制""一点"')).toEqual(['L3:2-L3:9', '改，更"克制"一点'])
  })
  it('parseLoc：合法同行区间', () => {
    expect(parseLoc('L7:11-L7:41')).toEqual({ sl: 7, sc: 11, el: 7, ec: 41 })
  })
  it('parseLoc：跨行/非法/空 返回 null', () => {
    expect(parseLoc('L7:11-L8:41')).toBeNull()
    expect(parseLoc('L7:11')).toBeNull()
    expect(parseLoc('')).toBeNull()
    expect(parseLoc('x7:11-y7:41')).toBeNull()
  })
  it('segmentFromText：按行号列区取文段（Python 切片语义 [sc-1, ec-1)）', () => {
    const text = ['---', '# 雾港', '雨把港口淋成一片灰。阿七攥着灯。', ''].join('\n')
    // 第 3 行：雨(1)…灰(9)。(10)…；L3:1-L3:10 → 前 9 字符（不含第 10 列）
    expect(segmentFromText(text, 'L3:1-L3:10')).toBe('雨把港口淋成一片灰')
  })
  it('segmentFromText：结束列越界钳到行尾（与主人脚本 python slice 同义）', () => {
    const text = ['a', '雨把港口淋成一片灰。'].join('\n')
    expect(segmentFromText(text, 'L2:1-L2:99')).toBe('雨把港口淋成一片灰。')
  })
  it('segmentFromText：行越界/起始列越界 返回 null', () => {
    const text = ['a', 'b'].join('\n')
    expect(segmentFromText(text, 'L9:1-L9:5')).toBeNull()
    expect(segmentFromText(text, 'L1:9-L1:99')).toBeNull()
  })
  it('parseAnnotationCsv：保留空行占位（行号与 csv.reader 口径一致）', () => {
    const rows = parseAnnotationCsv('L1:1-L1:3,改\n\nL2:2-L2:5,再改\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual({ loc: '', note: '', before: '' })
    expect(rows[2].loc).toBe('L2:2-L2:5')
  })
  it('parseAnnotationCsv：记录引号字段的批注意图', () => {
    const rows = parseAnnotationCsv('L5:1-L5:4,"别用, 逗号"')
    expect(rows[0].note).toBe('别用, 逗号')
  })
  it('parseAnnotationCsv：第三列 before（编辑器划词写入）', () => {
    const rows = parseAnnotationCsv('L10:1-L10:20,改这句,雨把港口淋成一片灰')
    expect(rows[0].before).toBe('雨把港口淋成一片灰')
  })
  it('escapeCsvField：逗号/引号/换行转义', () => {
    expect(escapeCsvField('普通')).toBe('普通')
    expect(escapeCsvField('a,b')).toBe('"a,b"')
    expect(escapeCsvField('说"话"')).toBe('"说""话"""')
  })
})
