#!/usr/bin/env node
// 织卷自维护补丁：给 dsh-sdk-jsonrpc-server 加 session/cancel 中断口（幂等；install.sh 自动重放）
// 背景（2026-09-14 智能层调研）：dsh SDK 公开协议只有 initialize/session/prompt/shutdown，
// HarnessClient 注释明言 "There is no wire-level cancel: a timed-out request stays running
// server-side until the runtime is closed"；但 runtime 内部 Agent.cancel(cause, options)
// （dsh-agent runtime-types.d.ts）真实存在，且 jsonrpc-server 的 sessions 表已持有
// rec.handle.agent —— 此补丁只加一个转发方法，不改任何既有行为；客户端用
// HarnessClient.request('session/cancel', { sessionId }) 调用（低阶口公开）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server', 'lib', 'index.js')
if (!existsSync(target)) {
  console.error('PATCH-SKIP: 未找到 ' + target)
  process.exit(0)
}
const src = readFileSync(target, 'utf8')
if (src.includes('session/cancel')) {
  console.log('PATCH-SKIP: session/cancel 已存在（幂等）')
  process.exit(0)
}

const methodRe = /([ \t]*)(async handleRequest\(method, params\) \{)/
if (!methodRe.test(src)) {
  console.error('PATCH-FAIL: 未找到 handleRequest 锚点')
  process.exit(1)
}
const injected =
  '$1/**\n' +
  '$1 * Cancel one session\'s active turn immediately (zhijuan patch; mirrors Agent.cancel).\n' +
  '$1 * @param params - target session id.\n' +
  '$1 * @returns whether an agent was cancelled.\n' +
  '$1 */\n' +
  '$1async cancel(params) {\n' +
  '$1\tconst rec = this.sessions.get(params && params.sessionId);\n' +
  '$1\tconst agent = rec && rec.handle && rec.handle.agent;\n' +
  '$1\tif (!agent) return { cancelled: false };\n' +
  '$1\tagent.cancel({ kind: "user" });\n' +
  '$1\treturn { cancelled: true };\n' +
  '$1}\n' +
  '$1async handleRequest(method, params) {'
let out = src.replace(methodRe, injected)
if (out === src) {
  console.error('PATCH-FAIL: 方法注入未生效')
  process.exit(1)
}

const caseRe = /([ \t]*)(case "session\/prompt": return this\.prompt\(params\);)/ // 两组：缩进 + case 语句
if (!caseRe.test(src)) {
  console.error('PATCH-FAIL: 未找到 prompt case')
  process.exit(1)
}
out = out.replace(caseRe, '$1$2\n$1case "session/cancel": return this.cancel(params);')
writeFileSync(target, out, 'utf8')
console.log('PATCH-OK: session/cancel 已注入 ' + target)
// 自检：新 case 必须独立成行
const check = readFileSync(target, 'utf8')
const line = check.split('\n').find((l) => l.includes('"session/cancel"'))
if (!line || line.includes('session/prompt')) {
  console.error('PATCH-FAIL: 自检未通过——case 行异常: ' + JSON.stringify(line))
  process.exit(1)
}
