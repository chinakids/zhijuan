#!/usr/bin/env node
// 织卷自维护补丁：给 dsh-sdk-jsonrpc-server 的 session/prompt 加 per-session reasoningEffort 透传
// （幂等；install.sh 自动重放）。先例=patch-server-maxtokens（同请求链）；本补丁在其后重放。
// 背景（2026-09-20 智能层）：21:00 轮直调实测同场景 revision 类任务 reasoning_effort=low 比默认档
// 提速 10.7×（47.95s vs 511.96s）且质量等价；子任务输出预算已能按 kind 分层（maxTokens），
// 思考档位同样需要 per-session 控制——只给「改」类长检查（revision）开 low，聊天/短巡查保持默认。
// 实现：SDK 高层 HarnessClient.prompt 不带档位；低阶 session/prompt 携带可选 reasoningEffort，
// 懒创建 agent 时经 agents.create 的 setup 安装模型选择（installModelSelection——dsh-headless
// /dsh dsh-agent 的官方公开模式，dsh-agent-loop 的 agent/request 瀑布据此覆写本轮请求配置），
// 不改 AgentOptions 类型、不动 agent-loop 内部。不携带 = 原逻辑（模型默认档、不传参）。
// 前置声明：providers.ts 的模型条目须声明 reasoningEfforts 档位表（否则 pi-ai 按非推理模型拒绝 low，
// 请求路径抛 UNSUPPORTED_REASONING_EFFORT）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server', 'lib', 'index.js')
if (!existsSync(target)) {
  console.error('PATCH-SKIP: 未找到 ' + target)
  process.exit(0)
}
const src0 = readFileSync(target, 'utf8')
if (src0.includes('params && params.reasoningEffort')) {
  console.log('PATCH-SKIP: per-session reasoningEffort 已存在（幂等）')
  process.exit(0)
}
let src = src0

function must(cond, msg) {
  if (!cond) {
    console.error('PATCH-FAIL: ' + msg)
    process.exit(1)
  }
}

// 1) 导入 installModelSelection（dsh-headless 同为从 '@deepseek-ai/dsh-agent' 具名导入）
const imp0 = 'import * as LlmDeepSeek from "@deepseek-ai/dsh-llm-deepseek";'
must(src.includes(imp0), '未找到 LlmDeepSeek 导入锚点')
src = src.replace(
  imp0,
  imp0 + '\nimport { installModelSelection } from "@deepseek-ai/dsh-agent";'
)

// 2) prompt 透传（session 懒创建于首次 prompt）
const p1 = '\t\t// zhijuan patch: per-session maxTokens（可选；懒创建时作为该 agent 输出预算）\n\t\tconst rec = await this.getOrCreateSession(params.sessionId, params && params.maxTokens);'
must(src.includes(p1), '未找到 prompt 锚点')
src = src.replace(
  p1,
  '\t\t// zhijuan patch: per-session maxTokens（可选；懒创建时作为该 agent 输出预算）\n' +
  '\t\t// zhijuan patch: per-session reasoningEffort（可选；懒创建时作为该 agent 思考档位，经 setup 装模型选择）\n' +
  '\t\tconst rec = await this.getOrCreateSession(params.sessionId, params && params.maxTokens, params && params.reasoningEffort);'
)

// 3) getOrCreateSession 透传
const p2 = 'async getOrCreateSession(sessionId, maxTokens) {'
must(src.includes(p2), '未找到 getOrCreateSession 锚点')
src = src.replace(p2, 'async getOrCreateSession(sessionId, maxTokens, reasoningEffort) {')
const p3 = 'const creation = this.createSession(sessionId, maxTokens);'
must(src.includes(p3), '未找到 createSession 调用锚点')
src = src.replace(p3, 'const creation = this.createSession(sessionId, maxTokens, reasoningEffort);')

// 4) createSession：per-session 经 setup 安装模型选择（installModelSelection 与 dsh-headless 同构；
//    仅当携带档位时安装——不携带=既有行为）
const p4 = 'async createSession(sessionId, maxTokens) {\n\t\tconst rec = { handle: await this.ctx.agents.create({\n\t\t\tsessionId: SessionId(sessionId),\n\t\t\tmeta: { cwd: this.cwd },'
must(src.includes(p4), '未找到 createSession 锚点')
src = src.replace(
  p4,
  'async createSession(sessionId, maxTokens, reasoningEffort) {\n' +
  '\t\tconst rec = { handle: await this.ctx.agents.create({\n' +
  '\t\t\tsessionId: SessionId(sessionId),\n' +
  '\t\t\tmeta: { cwd: this.cwd },\n' +
  '\t\t\t...(reasoningEffort !== void 0 ? { setup: (agentCtx) => { installModelSelection(agentCtx, { current: { provider: this.provider, model: this.model, reasoningEffort }, assembled: void 0 }); } } : {}),'
)

writeFileSync(target, src, 'utf8')
console.log('PATCH-OK: per-session reasoningEffort 透传已注入')
