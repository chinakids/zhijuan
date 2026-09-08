// ===== 织卷 · 模型适配接入层（厂商预设表） =====
// 共享给主进程 runtime（生成 dsh profile 的 LLM override patch 与子进程环境）和渲染层设置页（服务商表单）。
// 协议注：openai-completions → baseURL 需自带 /v1（pi-ai 再补 /chat/completions）；
//        anthropic-messages → baseURL 为主机根（pi-ai 再补 /v1/messages）。
import type { AppSettings, LlmProviderCfg, LlmProviderId } from './types'

export interface ProviderPreset {
  id: LlmProviderId
  name: string
  kind: 'local' | 'remote'
  api: 'openai-completions' | 'anthropic-messages'
  /** 厂商默认 wire baseURL（协议所需路径段已含） */
  baseURL: string
  /** 引擎子进程读 key 用的环境变量名 */
  apiKeyEnv: string
  needsKey: boolean
  keyHint: string
  compat?: Record<string, unknown>
  models: ModelEntry[]
}

/** 模型条目：id + 可选的 dsh 引擎级声明（如 reasoningEfforts:false=按非推理模型处，关掉超长思考流） */
export interface ModelEntry {
  id: string
  note?: string
  /** 声明模型支持的思考档位；false=非推理模型（请求不开启 thinking，直接出正文） */
  reasoningEfforts?: false | Record<string, string | null>
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'local',
    name: '本地 vLLM',
    kind: 'local',
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:8888/v1',
    apiKeyEnv: 'LOCAL_LLM_KEY',
    needsKey: false,
    keyHint: '本机局域网内的 vLLM 服务，默认无需 key',
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      // vLLM 上该模型模板默认开思考：实测单轮输出 1.5 万字 reasoning 才落笔（8 分钟驱动超时）。写作要快速产出，
      // 显式 chat_template_kwargs.thinking=false 关思考；reasoningEfforts:false 只声明 off 档=不传参，vLLM 默认仍开，单独不够。
      chatTemplateKwargs: { thinking: false }
    },
    // 模型 id 以 127.0.0.1:8888 实际服务的为准（vLLM 于 2026-09 重启换为 vision-exp-uncensored；旧的 0731 id 已 404/空返）。
    // reasoningEfforts:false = 按非推理模型处：该模型深度思考极长（实测单轮 1.5 万字 reasoning 才落笔），写作场景要快速产出，不开启 thinking。
    models: [{ id: 'deepseek-v4-flash-vision-exp-uncensored', reasoningEfforts: false }]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'remote',
    api: 'openai-completions',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    needsKey: true,
    keyHint: 'platform.deepseek.com 创建 API key',
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    models: [
      { id: 'deepseek-v4-flash', note: '轻量快，日常写作够用' },
      { id: 'deepseek-v4-pro', note: '更强，更慢更贵' }
    ]
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    kind: 'remote',
    api: 'openai-completions',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'BIGMODEL_API_KEY',
    needsKey: true,
    keyHint: 'open.bigmodel.cn 创建 API key',
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    models: [{ id: 'glm-5.3-flash', note: '当前旗舰，成本低' }]
  },
  {
    id: 'openai',
    name: 'OpenAI GPT',
    kind: 'remote',
    api: 'openai-completions',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    needsKey: true,
    keyHint: 'platform.openai.com 创建 API key（国内走代理时改 baseUrl）',
    compat: { maxTokensField: 'max_tokens' },
    models: [
      { id: 'gpt-5.6', note: '旗舰' },
      { id: 'gpt-4o-mini', note: '轻量便宜' }
    ]
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    kind: 'remote',
    api: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    needsKey: true,
    keyHint: 'console.anthropic.com 创建 API key（国内走代理时改 baseUrl）',
    compat: { supportsTemperature: true },
    models: [
      { id: 'claude-sonnet-4-5', note: '主力，擅长长文' },
      { id: 'claude-haiku-4-5', note: '轻量快' },
      { id: 'claude-opus-4-5', note: '最强，最贵' }
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'remote',
    api: 'openai-completions',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GOOGLE_API_KEY',
    needsKey: true,
    keyHint: 'aistudio.google.com 创建 API key（国内需代理）',
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    models: [
      { id: 'gemini-2.5-flash', note: '快，性价比高' },
      { id: 'gemini-2.5-pro', note: '强' }
    ]
  }
]

export const PROVIDER_IDS = PROVIDER_PRESETS.map((p) => p.id) as LlmProviderId[]

export function providerById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id)
}

/** dsh profile 里的 provider 路由 id（加 zj- 前缀，避免与引擎自带厂商目录的任何 id 撞名） */
export function routeId(id: LlmProviderId): string {
  return 'zj-' + id
}

export interface ActiveProvider {
  preset: ProviderPreset
  route: string
  baseUrl: string
  model: string
  apiKey: string
  apiKeyEnv: string
  /** 当前生效模型在预设里的完整条目（含引擎级声明；用户自定义 id 时 undefined） */
  modelEntry?: ModelEntry
}

/** 从设置解析当前活跃厂商（含用户覆盖的 baseUrl/model/apiKey） */
export function activeProvider(s: AppSettings): ActiveProvider {
  const id: LlmProviderId = PROVIDER_IDS.includes(s.llm?.active) ? s.llm.active : 'local'
  const preset = providerById(id) ?? providerById('local')!
  const cfg: LlmProviderCfg = s.llm?.providers?.[id] ?? {}
  const model = cfg.model?.trim() || preset.models[0]?.id || ''
  return {
    preset,
    route: routeId(id),
    baseUrl: cfg.baseUrl?.trim() || preset.baseURL,
    model,
    apiKey: cfg.apiKey ?? '',
    apiKeyEnv: preset.apiKeyEnv,
    modelEntry: preset.models.find((m) => m.id === model)
  }
}

/** 生成 dsh profile 的 LLM override patch YAML（provider 路由 + agent-default-model），默认本地也写（幂等） */
export function buildLlmOverrideYml(p: ActiveProvider): string {
  const js = JSON.stringify
  const compat =
    p.preset.compat && Object.keys(p.preset.compat).length
      ? '        compat:\n' + Object.entries(p.preset.compat).map(([k, v]) => `          ${k}: ${JSON.stringify(v)}\n`).join('')
      : ''
  return (
    '- id: llm-pi-ai\n' +
    '  config:\n' +
    '    providers:\n' +
    `      ${p.route}:\n` +
    `        displayName: ${js(p.preset.name)}\n` +
    `        api: ${p.preset.api}\n` +
    `        baseURL: ${js(p.baseUrl)}\n` +
    `        apiKeyEnv: ${p.apiKeyEnv}\n` +
    compat +
    '        models:\n' +
    `          - id: ${js(p.model)}\n` +
    modelDeclYaml(p.modelEntry) +
    '- id: agent-default-model\n' +
    '  config:\n' +
    `    provider: ${p.route}\n` +
    `    model: ${js(p.model)}\n`
  )
}

/** 模型条目的引擎级声明（YAML 行）：当前只有 reasoningEfforts（false=按非推理模型处；对象=声明各档位 wire 值） */
function modelDeclYaml(m?: ModelEntry): string {
  if (!m || m.reasoningEfforts === undefined) return ''
  const v =
    typeof m.reasoningEfforts === 'object'
      ? JSON.stringify(m.reasoningEfforts)
      : String(m.reasoningEfforts)
  return `            reasoningEfforts: ${v}\n`
}
