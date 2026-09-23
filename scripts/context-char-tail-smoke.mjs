// 织卷 · 真模型端到端走查——「人物档案超预算装配**结尾**」（无 GUI）
// 场景：人物档 >4000 字符（基础档案在头、切片状态在尾）。上下文装配应保尾弃头，
//       并提示「开头已省略、可 zj_read_doc 现读」。修复前（2026-09-11）：slice(0,4000) 保头，
//       最新切片状态（文末追加）被裁掉——续写拿不到人物「现在变成什么样」。
// 走查目标（两次 runChat）：
//   A. 禁工具问「最近切片状态」→ 只凭上下文能答出尾部唯一事实（保尾生效）。
//   B. 允许工具问「基础档案职业」→ 头部被省略时应调用 zj_read_doc 现读并答出（提示生效）。
// 用法：cd ~/Desktop/织卷 && node scripts/context-char-tail-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-chartail-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '走查chartail'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('正文'), { recursive: true })

// ① 人物档：头部 = 基础档案（唯一事实：职业 灯塔守 / 性格 沉默寡言）＋填充到 >4000；
//    尾部 = 切片同步追写的状态小节（唯一事实：已搬到灯塔二楼，左腕系黑绳——只出现在文末）
const fill = Array.from({ length: 90 }, (_, i) => `- 早年经历填充行 ${i}：那年冬天她在码头替人看船，收了半罐咸鱼干当酬劳，后来再也没有见过那个船主。`).join('\n')
const profile = [
  '---', '姓名: 林晚', '身份: 灯塔守', '---', '',
  '## 基础档案', '',
  '- 职业：灯塔守（唯一事实：守塔人）', '- 性格：沉默寡言、固执', '- 外貌：黑发及腰', '',
  '## 早期经历', '', fill, '',
  '## 切片：第一幕_雾夜', '',
  '- 见到十年前自己的船票。', '',
  '## 切片：第二幕_约定', '',
  '- 林晚已搬到灯塔二楼，左腕系一根黑绳（唯一事实：当前状态）。'
].join('\n')
if (profile.length <= 4500) throw new Error('人物档未超预算，冒烟前提不成立')
writeFileSync(P('人物/林晚.md'), profile, 'utf-8')

// ② 第 1 章（走查对象）
writeFileSync(
  P('正文/第01章_约定.md'),
  ['---', '章号: 1', '题名: 约定', '切片: 第二幕_约定', '涉及人物: [林晚]', '---', '', '第一章正文。'].join('\n'),
  'utf-8'
)

// ③ bundle 主进程 agent 引擎（electron → stub）
const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const mod = await import(pathToFileURL(out).href)

const runOnce = async (prompt, allowTools) => {
  const events = []
  console.log('=== runChat：', prompt.slice(0, 40))
  await mod.runChat(
    { requestId: 'chartail-' + Date.now(), projectId: pid, chapterRel: '正文/第01章_约定.md', chapterTitle: '第1章', prompt, quote: null },
    (e) => {
      events.push(e)
      if (e.type === 'delta') process.stdout.write(e.text)
      else if (e.type === 'meta') console.log('\n[工具]', e.tool)
      else if (e.type === 'meta-done') console.log('[工具完成]', e.message.slice(0, 60))
      else if (e.type === 'error') console.error('\n[错误]', e.message)
    }
  )
  console.log('\n---')
  return events
}

// A. 禁工具：最近切片状态 → 尾部唯一事实
const evA = await runOnce('根据你读到的上下文回答（不要调用任何工具）：林晚最近的状态是什么？她此刻住在哪里？', false)
// B. 允许工具：基础档案职业 → 头部被省略、应 zj_read_doc 现读
const evB = await runOnce('林晚的基础档案里写的职业和性格是什么？如果上下文没有给出，请调用 zj_read_doc 读取 人物/林晚.md 后回答。', true)

await mod.shutdown()

const finalOf = (evs) => evs.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
const toolsOf = (evs) => evs.filter((e) => e.type === 'meta').map((e) => e.tool)
const fa = finalOf(evA)
const fb = finalOf(evB)
const ta = toolsOf(evA)
const tb = toolsOf(evB)
console.log('\n[A 最终]', fa)
console.log('[B 最终]', fb)
console.log('[A 工具]', JSON.stringify(ta), ' [B 工具]', JSON.stringify(tb))

// 断言：
// A：尾部事实（二楼）必须被模型答出（只能来自注入的结尾）
const aPass = fa.includes('二楼')
// B：要么调了 zj_read_doc 并答出职业，要么模型在调用后给出「灯塔守」
const bPass = (tb.includes('zj_read_doc') || tb.includes('zj_read_doc(char')) && fb.includes('灯塔守')
const pass = aPass && bPass
console.log('\n[A 保尾生效]', aPass, ' [B 现读提示生效]', bPass)
console.log(pass ? 'CHAR-TAIL SMOKE OK' : 'CHAR-TAIL SMOKE FAILED')
rmSync(tmp, { recursive: true, force: true })
process.exit(pass ? 0 : 1)
