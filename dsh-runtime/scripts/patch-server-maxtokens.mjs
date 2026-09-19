#!/usr/bin/env node
// 织卷自维护补丁：给 dsh-sdk-jsonrpc-server 的 session/prompt 加 per-session maxTokens 透传（幂等；install.sh 自动重放）
// 背景（2026-09-19 智能层）：SDK 高层 HarnessClient.prompt(sessionId, contentBlocks) 不带输出预算，
// DeepSeekHarness 构造 maxTokens 是进程级档（initialize → server this.maxTokens → 每个懒建 agent 继承）。
// 织卷子任务输出预算需要按 kind 分层（2026-09-19 06:00 轮实锤：revision 驱动 outputTokens=12288 卡顶、
// finish=max-tokens、无 text，靠 def.retry 兜底）：子任务每次都是新 session（懒创建于首次 prompt），
// 因此让 session/prompt 携带可选 maxTokens、创建 agent 时覆盖全局档即可——不改既有行为（不携带=原逻辑）。
// 客户端走 HarnessClient.request('session/prompt', { sessionId, contentBlocks, maxTokens })（低阶口公开，
// 与 session/cancel 补丁同法）；此补丁只加透传，不动协议 schema。
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
if (src0.includes('params && params.maxTokens')) {
  console.log('PATCH-SKIP: per-session maxTokens 已存在（幂等）')
  process.exit(0)
}
let src = src0

function must(cond, msg) {
  if (!cond) {
    console.error('PATCH-FAIL: ' + msg)
    process.exit(1)
  }
}

// 1) prompt 透传（session 懒创建于首次 prompt）
const p1 = 'async prompt(params) {\n\t\tconst rec = await this.getOrCreateSession(params.sessionId);'
must(src.includes(p1), '未找到 prompt 锚点')
src = src.replace(
  p1,
  'async prompt(params) {\n\t\t// zhijuan patch: per-session maxTokens（可选；懒创建时作为该 agent 输出预算）\n\t\tconst rec = await this.getOrCreateSession(params.sessionId, params && params.maxTokens);'
)

// 2) getOrCreateSession 透传
const p2 = 'async getOrCreateSession(sessionId) {'
must(src.includes(p2), '未找到 getOrCreateSession 锚点')
src = src.replace(p2, 'async getOrCreateSession(sessionId, maxTokens) {')
const p3 = 'const creation = this.createSession(sessionId);'
must(src.includes(p3), '未找到 createSession 调用锚点')
src = src.replace(p3, 'const creation = this.createSession(sessionId, maxTokens);')

// 3) createSession：per-session 覆盖全局档
const p4 = 'async createSession(sessionId) {'
must(src.includes(p4), '未找到 createSession 锚点')
src = src.replace(p4, 'async createSession(sessionId, maxTokens) {')
const p5 = '...this.maxTokens === void 0 ? {} : { maxTokens: this.maxTokens }'
must(src.includes(p5), '未找到 maxTokens 继承锚点')
src = src.replace(
  p5,
  '...(maxTokens !== void 0 ? { maxTokens } : (this.maxTokens === void 0 ? {} : { maxTokens: this.maxTokens }))'
)

writeFileSync(target, src, 'utf8')
console.log('PATCH-OK: per-session maxTokens 透传已注入')
