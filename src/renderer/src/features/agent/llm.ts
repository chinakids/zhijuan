// ===== 织卷 agent · 本地 LLM 调用（OpenAI 兼容） =====

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return base + (base.endsWith('/v1') ? '' : '/v1') + '/chat/completions'
}

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  }
}

/** 流式走完整个回复；出错抛异常（由调用方展示） */
export async function streamChat(opts: {
  baseUrl: string
  model: string
  apiKey: string
  messages: ChatMessage[]
  onToken: (t: string) => void
  signal?: AbortSignal
}): Promise<void> {
  const res = await fetch(endpoint(opts.baseUrl), {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true, temperature: 0.8 }),
    signal: opts.signal
  })
  if (!res.ok) throw new Error('LLM HTTP ' + res.status + ': ' + (await res.text().catch(() => '')))
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
        const delta = j.choices?.[0]?.delta?.content
        if (delta) opts.onToken(delta)
      } catch {
        // 跳过无法解析的行
      }
    }
  }
}

/** 非流式完整请求，返回解析出的 JSON（按数组提取或整体解析）；失败抛错 */
export async function completeJson(opts: {
  baseUrl: string
  model: string
  apiKey: string
  messages: ChatMessage[]
  temperature?: number
}): Promise<unknown> {
  const res = await fetch(endpoint(opts.baseUrl), {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: false, temperature: opts.temperature ?? 0.2 })
  })
  if (!res.ok) throw new Error('LLM HTTP ' + res.status + ': ' + (await res.text().catch(() => '')))
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = j.choices?.[0]?.message?.content ?? ''
  const first = text.indexOf('[')
  const last = text.lastIndexOf(']')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {
      // 继续尝试整体解析
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('模型未返回可解析的 JSON：' + text.slice(0, 200))
  }
}
