import { describe, expect, it } from 'vitest'
import { activeProvider, buildLlmOverrideYml } from '../../src/shared/providers'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

describe('providers（模型适配接入层：预设/活跃解析/override 生成）', () => {
  it('local 预设声明模型思考档位表（low/high/max 各档 wire 值，off 缺省=支持且不传参）', () => {
    const p = activeProvider(DEFAULT_SETTINGS)
    expect(p.route).toBe('zj-local')
    expect(p.model).toBe('deepseek-v4-flash-vision-exp-uncensored')
    expect(p.modelEntry?.reasoningEfforts).toMatchObject({ low: 'low', high: 'high', max: 'max' })
  })

  it('buildLlmOverrideYml 把 reasoningEfforts 档位表写进 models 条目', () => {
    const y = buildLlmOverrideYml(activeProvider(DEFAULT_SETTINGS))
    expect(y).toContain('deepseek-v4-flash-vision-exp-uncensored')
    expect(y).toContain('reasoningEfforts: {"low":"low","high":"high","max":"max"}')
    expect(y).toContain('http://127.0.0.1:8888/v1')
  })

  it('用户设置可覆盖 baseUrl/model（modelEntry 随之缺失=不输出声明）', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      llm: {
        ...DEFAULT_SETTINGS.llm,
        providers: { local: { baseUrl: 'http://10.0.0.5:9000/v1', model: 'custom-model-x' } }
      }
    }
    const p = activeProvider(s as never)
    expect(p.baseUrl).toBe('http://10.0.0.5:9000/v1')
    expect(p.model).toBe('custom-model-x')
    expect(p.modelEntry).toBeUndefined()
    const y = buildLlmOverrideYml(p)
    expect(y).not.toContain('reasoningEfforts')
    expect(y).toContain('custom-model-x')
  })

  it('未知 active 厂商回落 local', () => {
    const s = { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, active: '老板牌' } }
    expect(activeProvider(s as never).route).toBe('zj-local')
  })
})
