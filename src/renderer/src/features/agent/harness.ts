// ===== 织卷 · agent 渲染层客户端（走主进程 dsh 写作引擎） =====
// 事件总线：把主进程 agent:event 分发给本地订阅者；提供一次会话的发送辅助。
import type { AgentEvent } from '../../../../shared/types'

export interface AgentSendInput {
  requestId: string
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  prompt: string
  quote?: string | null
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** 焦点改稿任务（「让 agent 改」）放宽预算；默认 false 走常规 8min */
  focus?: boolean
}

type Handler = (e: AgentEvent) => void
const buses = new Set<Handler>()

function api(): any {
  return (window as any).zhijuan
}

export function subscribeAgent(cb: Handler): () => void {
  buses.add(cb)
  return () => {
    buses.delete(cb)
  }
}

// 挂一次 IPC 桥：主进程的 agent:event → 本地 handler
let bridgeAttached = false
export function attachAgentBridge() {
  if (bridgeAttached) return
  bridgeAttached = true
  const a = api()
  if (a?.onAgentEvent) {
    a.onAgentEvent((e: AgentEvent) => {
      for (const h of [...buses]) h(e)
    })
  }
}

/** 发一条消息并驱动事件直到本轮结束（done / error / aborted）。 */
export async function sendAgent(input: AgentSendInput, onEvent: Handler): Promise<'done' | 'error' | 'aborted'> {
  const a = api()
  if (!a?.agentSend) throw new Error('agent 通道未就绪')
  let finished = false
  let result: 'done' | 'error' | 'aborted' = 'done'
  const unsub = subscribeAgent((e) => {
    if (e.requestId !== input.requestId) return
    onEvent(e)
    if (e.type === 'done') {
      finished = true
      result = 'done'
    } else if (e.type === 'error' || e.type === 'aborted') {
      finished = true
      result = e.type
    }
  })
  try {
    await a.agentSend(input)
  } catch (e: any) {
    onEvent({ requestId: input.requestId, type: 'error', message: String(e?.message ?? e) })
    return 'error'
  } finally {
    // invoke 已回；给在途事件一点余量（正常早于 invoke 结束）
    const t = Date.now()
    while (!finished && Date.now() - t < 1500) {
      await new Promise((r) => setTimeout(r, 50))
    }
    unsub()
  }
  return result
}

export function cancelAgent(requestId: string) {
  api()?.agentCancel?.(requestId)
}

/** 回答某个 ask 批次（模型等答案） */
export function answerAgent(batch: string, answers: { id: string; selected: string[]; custom?: string }[]) {
  const a = api()
  if (!a?.agentAnswer) return Promise.resolve({ ok: false, error: 'agent 通道未就绪' } as { ok: boolean; error?: string })
  return a.agentAnswer(batch, answers) as Promise<{ ok: boolean; error?: string }>
}
