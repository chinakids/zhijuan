// ===== 织卷 · user-questions 写作引擎插件（zj-questions）=====
// 给 dsh 的 ask_user_question 工具提供一个织卷主进程可配合的 UI provider：
// 把问题以 zj/user-ask 会话事件发出（主进程在 session 事件流里看到并转给渲染层），
// 然后轮询答案目录（主进程把用户答案写成 JSON 文件）回灌给模型循环。
// 事实来源：@deepseek-ai/dsh-user-questions + dsh-tool-ask-user 的类型与源码。
// 自包含，被 scripts/build-plugins.mjs 打成 mjs 后按包名挂到 dsh-runtime/node_modules/zj-questions/。

// ---------- 最小接口（对应 @deepseek-ai/dsh-user-questions / cordis 契约）----------
interface AskOption {
  label: string
  description?: string
}
interface AskItem {
  id: string
  question: string
  header?: string
  options?: AskOption[]
  multiSelect?: boolean
}
interface AskRequest {
  questions: AskItem[]
  agent?: { session?: { append: (type: string, data: unknown) => unknown } } & Record<string, unknown>
  signal?: AbortSignal
}
interface Provider {
  ask: (request: AskRequest) => Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
}
interface Cordis {
  userQuestions: { registerProvider: (p: Provider) => unknown }
}

export const name = 'zj-questions'
export const inject = ['userQuestions']

import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** 答案目录：默认 ~/.zj-agent-answers，可被 ZJ_USER_ANSWER_DIR 覆盖（主进程会用 userData 下目录） */
const answerDir = () => process.env.ZJ_USER_ANSWER_DIR || (process.env.HOME || '/tmp') + '/.zj-agent-answers'

async function waitAnswer(batch: string, signal?: AbortSignal, timeoutMs = 20 * 60 * 1000) {
  const dir = answerDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, batch + '.json')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('ask_user_question 在用户回答前被取消')
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      try {
        unlinkSync(file)
      } catch {}
      return JSON.parse(raw)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('ask_user_question 等待回答超时')
}

export function apply(ctx: Cordis) {
  ctx.userQuestions.registerProvider({
    async ask(request) {
      const batch = 'ask-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      const session = request.agent?.session
      if (session?.append) {
        session.append('zj/user-ask', { batch, questions: request.questions })
      } else {
        process.stderr.write('[zj-questions] no session channel: ' + JSON.stringify(request.questions) + '\n')
      }
      return waitAnswer(batch, request.signal)
    }
  })
}
