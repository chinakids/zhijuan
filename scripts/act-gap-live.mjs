// 缺段占位「断链提示」· 真模型冒烟：buildWritingContext（真读盘临时项目库）→ 直连本地 vLLM，
// 验证模型**看到断链提示后**知道正文不完整（缺第 2、5 段）——提示行不是摆设。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/act-gap-live.mjs
import { writeProbeSettings, chatEndpoint } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-actgap-live'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/act-gap-live-bundle.mjs'

const libRoot = '/tmp/zj-smoke-actgap-live-library'
rmSync(libRoot, { recursive: true, force: true })
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: libRoot })

const pid = '占位冒烟'
const chDir = resolve(libRoot, pid, '正文')
mkdirSync(chDir, { recursive: true })
const FM = ['---', '章号: 1', '题名: 占位章', '切片: 第一幕', '涉及人物: [林晓]', '---', ''].join('\n') + '\n'
writeFileSync(
  resolve(chDir, '第01章_占位.md'),
  FM +
    '第一段正文，写得很顺。\n\n' +
    '<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->\n\n' +
    '第三段正文，接得上。\n\n' +
    '<!-- 分幕草稿缺第 5 段：此处情节未写成，待补齐 -->\n\n' +
    '第六段正文收尾。'
)

await esbuild({
  stdin: {
    contents: `export { buildWritingContext } from ${JSON.stringify(resolve(root, 'src/main/agent/context.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const { buildWritingContext } = await import(pathToFileURL(out).href)
const ctx = await buildWritingContext(pid, '正文/第01章_占位.md')
const blocks = ctx.blocks.join('\n\n')
console.log('=== 上下文块（前 400 字）===\n' + blocks.slice(0, 400) + '\n')

const resp = await fetch(chatEndpoint(), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'deepseek-v4-flash-vision-exp-uncensored',
    max_tokens: 1500,
    temperature: 0.3,
    messages: [
      { role: 'system', content: '你是织卷创作工作台的创作 agent 助手，回答直接、无套话。' },
      {
        role: 'user',
        content:
          blocks +
          '\n\n[任务] 请只用一两句话回答，不要用工具：1）本章正文是否完整？2）如果不完整，缺的是什么？'
      }
    ]
  })
})
if (!resp.ok) {
  console.error('模型 API 失败：' + resp.status + ' ' + (await resp.text()).slice(0, 300))
  process.exit(1)
}
const data = await resp.json()
const final = (data.choices?.[0]?.message?.content ?? '').trim()
console.log('\n=== 模型回答 ===\n' + final)

// 宽松断言：模型必须指出不完整 + 缺段号（第 2 段与第 5 段；阿拉伯或中文数字均可）
const mentionsGap = /不完整|缺失|缺了|断|有洞|未写/.test(final)
const mentions2 = /第\s*[2二]\s*段|第[2二]段|[2二]段.{0,6}未|缺.{0,6}[2二]/.test(final)
const mentions5 = /第\s*[5五]\s*段|第[5五]段|[5五]段.{0,6}未|缺.{0,6}[5五]/.test(final)
const ok = mentionsGap && mentions2 && mentions5
console.log('\n核对：gap=' + mentionsGap + ' 段2=' + mentions2 + ' 段5=' + mentions5 + ' => ' + (ok ? 'PASS（模型感知断链）' : 'FAIL'))
if (!ok) process.exit(1)

// 上一章断链承接（2026-09-13）：第02章上下文里的「上一章尾部」提示行，模型同样应感知
writeFileSync(
  resolve(chDir, '第02章_续.md'),
  ['---', '章号: 2', '题名: 续写章', '切片: 第一幕', '涉及人物: [林晓]', '---', ''].join('\n') +
    '\n第二章正文承接。'
)
const ctx3 = await buildWritingContext(pid, '正文/第02章_续.md')
const blocks3 = ctx3.blocks.join('\n\n')
console.log('\n=== 第02章上下文块（前 400 字）===\n' + blocks3.slice(0, 400))

const resp2 = await fetch(chatEndpoint(), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'deepseek-v4-flash-vision-exp-uncensored',
    max_tokens: 1500,
    temperature: 0.3,
    messages: [
      { role: 'system', content: '你是织卷创作工作台的创作 agent 助手，回答直接、无套话。' },
      {
        role: 'user',
        content:
          blocks3 +
          '\n\n[任务] 请只用一两句话回答，不要用工具：1）根据提供的上下文，上一章（第01章）正文是否完整？2）如果不完整，缺的是什么？'
      }
    ]
  })
})
if (!resp2.ok) {
  console.error('模型 API 失败：' + resp2.status + ' ' + (await resp2.text()).slice(0, 300))
  process.exit(1)
}
const data2 = await resp2.json()
const final2 = (data2.choices?.[0]?.message?.content ?? '').trim()
console.log('\n=== 模型回答（上一章承接）===\n' + final2)
const mentionsGap2 = /不完整|缺失|缺了|断|有洞|未写/.test(final2)
const mentions2b = /第\s*[2二]\s*段|第[2二]段|[2二]段.{0,6}未|缺.{0,6}[2二]/.test(final2)
const mentions5b = /第\s*[5五]\s*段|第[5五]段|[5五]段.{0,6}未|缺.{0,6}[5五]/.test(final2)
const ok2 = mentionsGap2 && mentions2b && mentions5b && /上一章|第01章|前文/.test(final2)
console.log('核对：gap=' + mentionsGap2 + ' 段2=' + mentions2b + ' 段5=' + mentions5b + ' 指向上一章=' + /上一章|第01章|前文/.test(final2) + ' => ' + (ok2 ? 'PASS（模型感知上一章断链）' : 'FAIL'))
process.exit(ok2 ? 0 : 1)
