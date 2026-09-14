import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tools } from '../../src/plugins/zj-core'

const readDoc = tools.find((t) => t.name === 'zj_read_doc')!
const exec = { signal: new AbortController().signal }

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zj-read-'))
  await writeFile(join(dir, '长文.md'), 'X'.repeat(1000) + 'MIDDLE' + 'Y'.repeat(1000) + 'TAILMARK')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('zj_read_doc（区间续读，Claude Code offset/limit 同构）', () => {
  it('超长时注明已读到第几字符、全文多长、续读所需 offset', async () => {
    const out = await readDoc.execute({ base: dir, file: '长文.md', maxChars: 100 } as never, exec as never)
    const s = String(out)
    expect(s).toContain('已读到第 100')
    expect(s).toContain('全文共')
    expect(s).toContain('offset=100')
    expect(s).toContain('X'.repeat(100))
  })

  it('offset 从中间续读：返回从指定字符开始的片段', async () => {
    const out = await readDoc.execute({ base: dir, file: '长文.md', maxChars: 100, offset: 995 } as never, exec as never)
    expect(String(out)).toContain('MIDDLE')
  })

  it('读到文件末尾标注明示，offset 越界给出回看指引', async () => {
    const out = await readDoc.execute({ base: dir, file: '长文.md', maxChars: 1000, offset: 1500 } as never, exec as never)
    expect(String(out)).toContain('已到文件末尾')
  })

  it('未超长时整篇返回（与原行为一致）', async () => {
    await writeFile(join(dir, '短文.md'), '短内容')
    const out = await readDoc.execute({ base: dir, file: '短文.md' } as never, exec as never)
    expect(String(out)).toContain('短内容')
    expect(String(out)).not.toContain('已读到第')
  })

  it('约定头字段保留（章号/题名等），不随 offset 丢失', async () => {
    await writeFile(join(dir, '章.md'), ['---', '章号: 3', '题名: 风起', '切片: 第三幕', '---', ''].join('\n') + 'BODY'.repeat(50))
    const out = await readDoc.execute({ base: dir, file: '章.md', maxChars: 10 } as never, exec as never)
    expect(String(out)).toContain('章号: 3')
    expect(String(out)).toContain('题名: 风起')
  })
})
