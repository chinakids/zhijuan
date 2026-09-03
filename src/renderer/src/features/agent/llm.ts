// ===== 织卷 agent · 本地 LLM 流式调用（OpenAI 兼容 SSE） =====

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChatOpts {
  baseUrl: string
  model: string
  apiKey: string
  messages: ChatMessage[]
  onToken: (t: string) => void
  signal?: AbortSignal
}

/** 流式走完整个回复；出错抛异常（由调用方展示） */
export async function streamChat({ baseUrl, model, apiKey, messages, onToken, signal }: StreamChatOpts): Promise<void> {
  const base = baseUrl.replace(/\/$/, '')
  const url = base + (base.endsWith('/v1') ? '' : '/v1') + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.8 }),
    signal
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LLM 响应 ${res.status}：${detail.slice(0, 200)}`)
  }
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
        const j = JSON.parse(data)
        const delta = j.choices?.[0]?.delta?.content
        if (delta) onToken(delta)
      } catch {
        // 忽略非 JSON 数据片（keep-alive 等）
      }
    }
  }
}
