// 织卷 · 「聊天输出纯度」真模型探针 v3（2026-09-22 智能层轮，候选 1）
// v1/v2 教训：直连 [system,user] 复刻不出 18:00 轮实测的元说明（「几点处理思路/——约 120 字/未使用…」）——
//   诱因在 runChat 全链（技能激活注入块【我的写作习惯】+上下文装配）。v3=runChat 全链 A/B：
//   【场景 A·创作行动】真项目「织卷smoke」副本 + 工作区启用态「写作习惯」技能（draftSkillFromStats 真实产出），
//      prompt=「按我的写作习惯，续写…（约 120 字）」→ 技能注入面真实触发；唯一变量=引擎 system 块：
//      old（原单句身份，从 engine.ts 源码还原）vs new（身份+【输出纪律】= 现仓库代码）。
//      判据：new 版元说明违规 < old 版（且 new 版=0）。
//   【场景 B·评价类】new 引擎 + 「这一段写得怎么样？」→ 断言仍给出分析（纪律不误杀提问/评价类）。
// 用法：cd ~/Desktop/织卷 && node scripts/chat-purity-live.mjs（真模型，建议后台+notify）
// 固定后置：改 runChat system/纪律文案后复跑本探针；engine.ts 改动自动被 new 版携带。
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, readFileSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-purity-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
const ws = join(tmp, 'ws')
const lib = join(tmp, 'lib')
writeProbeSettings({ libraryRoot: lib, workspace: ws })

// =====================================================================
// ① 真实草稿产出（draftSkillFromStats）→ 启用态写盘（与 insights-draft-live 同构）
// =====================================================================
async function bundleEntry(entry, aliasElectron) {
  const out = join(tmp, 'bundle-' + Math.random().toString(36).slice(2) + '.mjs')
  await esbuild({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    ...(aliasElectron ? { alias: { electron: resolve(root, 'scripts/electron-stub.mjs') } } : {}),
    external: ['node:*'],
    logLevel: 'warning'
  })
  return import(pathToFileURL(out).href)
}
const wi = await bundleEntry(resolve(root, 'src/shared/writingInsights.ts'), false)

const FM = '---\n章号: 1\n题名: 夜航\n切片: 第一幕\n涉及人物: []\n---\n'
const F = '正文/第01章_夜航.md'
const C = (before, after) => ({ file: F, before: FM + '\n' + before + '\n', after: FM + '\n' + after + '\n' })
const yixia = [
  ['他鼓起勇气，一下推开了门。', '他鼓起勇气，推开了门。'],
  ['她把信纸一下拍在桌上。', '她把信纸拍在桌上。'],
  ['门在风里一下撞出声响。', '门在风里撞出声响。']
].map((a) => C(a[0], a[1]))
const split = [
  ['她站在窗前看着外面渐渐亮起来的天色，心里那些乱糟糟的念头也跟着一点点安静了下来。', '她站在窗前。天色渐渐亮起来。心里那些乱糟糟的念头，一点点安静下来。'],
  ['雨下了整整一夜，他在候车厅的椅子上坐着，看着玻璃上的水痕慢慢滑下去。', '雨下了整整一夜。他在候车厅的椅子上坐着。玻璃上的水痕慢慢滑下去。']
].map((a) => C(a[0], a[1]))
const merged = [
  ['雨停了。灯灭了。街上没有一个人影。', '雨停了，灯灭了，街上没有一个人影，只有远处传来一声模糊的犬吠。']
].map((a) => C(a[0], a[1]))
const short = [
  ['她不知道为什么心里忽然涌上一种说不清道不明的委屈，眼泪在眼眶里直打转。', '她忽然觉得委屈，眼泪在眼眶里打转。']
].map((a) => C(a[0], a[1]))
const signals = wi.buildSignals({
  changes: [...yixia, ...split, ...merged, ...short],
  proposals: [],
  chapters: [{ file: F, raw: FM + '\n她站在码头边，海风把她的头发吹得乱七八糟。\n' }]
})
const draftText = wi.draftSkillFromStats(signals, { generatedAt: new Date('2026-09-22T18:00:00+08:00') })
if (!draftText.includes('disabled: true')) {
  console.log('FAIL：草稿未含 disabled: true（draftSkillFromStats 产出异常）')
  process.exit(1)
}
const enabledText = draftText.replace('disabled: true', 'disabled: false')

// ② 真项目副本（织卷smoke → tmp 库；零污染真库）+ ③ 启用态技能写盘
const srcProj = join(process.env.HOME ?? '', 'Documents/织卷项目库/织卷smoke')
if (!existsSync(srcProj)) {
  console.log('FAIL：找不到真项目织卷smoke：' + srcProj)
  process.exit(1)
}
cpSync(srcProj, join(lib, '织卷smoke'), { recursive: true })
const skillDir = join(ws, 'skills/writing-habits')
mkdirSync(skillDir, { recursive: true })
writeFileSync(join(skillDir, 'SKILL.md'), enabledText, 'utf-8')

// =====================================================================
// ④ 双引擎 bundle：new=现仓库 engine.ts；old=源码还原（去掉纪律块）
// =====================================================================
async function bundleRunChat(entryPoint) {
  const mod = await bundleEntry(entryPoint, true)
  return { runChat: mod.runChat, shutdown: mod.shutdown }
}
const runNew = await bundleRunChat(resolve(root, 'src/main/agent/engine.ts'))

const engineSrc = readFileSync(resolve(root, 'src/main/agent/engine.ts'), 'utf-8')
const iA = engineSrc.indexOf('  // 系统身份 + 输出纪律') // 纪律注释起始（含两空格缩进）
const iB = engineSrc.indexOf('  parts.push(envBlock(input.projectId, input.chapterRel))')
if (iA === -1 || iB === -1 || iA > iB) {
  console.log('FAIL：engine.ts 纪律块定位失败（iA=' + iA + ' iB=' + iB + '）')
  process.exit(1)
}
const oldSrc =
  engineSrc.slice(0, iA) +
  "  parts.push('你是「织卷」创作工作台的创作 agent，协助作者（用户）写作。')\n" +
  engineSrc.slice(iB)
if (oldSrc.includes('【输出纪律】')) {
  console.log('FAIL：oldSrc 仍含纪律文本')
  process.exit(1)
}
const oldEngineFile = join(root, 'src/main/agent/.engine-old-tmp.ts')
writeFileSync(oldEngineFile, oldSrc, 'utf-8')
let runOld = null
try {
  runOld = await bundleRunChat(oldEngineFile)
} finally {
  rmSync(oldEngineFile, { force: true })
}
if (!runOld) {
  console.log('FAIL：old 引擎 bundle 失败')
  process.exit(1)
}
// =====================================================================
// ⑤ 场景运行（runChat 全链）
// =====================================================================
const SCENE =
  '凌晨一点的便利店门口，她蹲在台阶上，手里攥着一把滴水的伞。塑料袋里装着两盒酸奶和一卷纸巾，都是临走前塞进去的。'
const WRITE_REQ =
  '你是一篇小说作者。请按我的写作习惯，续写下面场景的下一段（约 120 字，中文）。\n\n【场景】\n' + SCENE
const REVIEW_REQ = '这一段写得怎么样？你觉得有什么需要调整的地方？\n\n【场景】\n' + SCENE

async function runOne(tag, eng, prompt) {
  console.log(`\n=== ${tag} 开始：`, new Date().toISOString())
  let finalText = ''
  let err = null
  let metaCount = 0
  await eng.runChat(
    {
      requestId: tag + '-' + Date.now(),
      projectId: '织卷smoke',
      chapterRel: '正文/第01章_雾港栈桥.md',
      chapterTitle: '雾港栈桥',
      prompt,
      quote: null
    },
    (e) => {
      if (e.type === 'delta') process.stdout.write(e.text)
      else if (e.type === 'meta') metaCount++
      else if (e.type === 'final') finalText = e.text
      else if (e.type === 'error') err = e.message
    }
  )
  await eng.shutdown?.()
  console.log(`\n=== ${tag} 完成（${finalText.length} 字符，工具调用 ${metaCount} 次，err=${err ?? '无'}）`)
  if (err) throw new Error(tag + ' error: ' + err)
  return finalText
}

const META = /几点|思路|供你参考|约\s*\d+\s*字|——\s*\d+\s*字|未使用|说明[:：]|（说明|以上是|以下为|希望对你有帮助|不知道这样|修改建议|供参考|正文约|建议如下|建议：|注意[:：]/
const META_HEAD = /^[（(【\[]|^①|^以下是|^以上是|^说明[:：]/
const metaViol = (t) => (META.test(t) ? 1 : 0)
const headBad = (t) => META_HEAD.test(t.trim())

const aOld = [await runOne('A-old#1', runOld, WRITE_REQ), await runOne('A-old#2', runOld, WRITE_REQ)]
const aNew = [await runOne('A-new#1', runNew, WRITE_REQ), await runOne('A-new#2', runNew, WRITE_REQ)]
const bNew = await runOne('B-new#1', runNew, REVIEW_REQ)

const sOld = aOld.map((t) => ({ len: t.length, meta: metaViol(t), headBad: headBad(t) }))
const sNew = aNew.map((t) => ({ len: t.length, meta: metaViol(t), headBad: headBad(t) }))
console.log('\n=== 场景 A 指标 ===')
console.log('old:', JSON.stringify(sOld))
console.log('new:', JSON.stringify(sNew))

const oldViol = sOld.filter((s) => s.meta || s.headBad).length
const newViol = sNew.filter((s) => s.meta || s.headBad).length
const passA = newViol < oldViol && newViol === 0
const bLen = bNew.length
const bHasAnalysis = /建议|问题|节奏|可以|注意|调整|描写|对话|人物|氛围/.test(bNew)
const passB = bLen > 120 && bHasAnalysis

console.log(`判据 A（创作行动纯度）：old 违规 ${oldViol}/2 vs new 违规 ${newViol}/2 → ${passA ? 'OK' : 'FAIL'}`)
console.log(`判据 B（评价类未被误杀）：len=${bLen} 含分析词=${bHasAnalysis} → ${passB ? 'OK' : 'FAIL'}`)
console.log(passA && passB ? 'CHAT-PURITY-LIVE OK' : 'CHAT-PURITY-LIVE FAILED')

const report = [
  '=== 织卷 · 聊天输出纯度探针报告（2026-09-22 智能层轮，v3 全链）===',
  '模型：本机 vLLM + 真边车（runChat 全链：织卷smoke 副本 + 启用态「写作习惯」技能真实注入）',
  '',
  '【系统块】old = 原单句身份（从 engine.ts 源码还原）；new = 身份 + 【输出纪律】（现仓库代码）',
  '',
  '【场景 A·创作行动（按我的写作习惯续写，约 120 字）】',
  ...aOld.map((t, i) => `-- old#${i + 1}（${t.length}字）--\n${t}\n`),
  ...aNew.map((t, i) => `-- new#${i + 1}（${t.length}字）--\n${t}\n`),
  'old 违规=' + oldViol + '/2；new 违规=' + newViol + '/2 → ' + (passA ? 'OK' : 'FAIL'),
  '',
  '【场景 B·评价类（这段写得怎么样）】',
  `-- new（${bLen}字）--\n${bNew}\n`,
  '含分析词=' + bHasAnalysis + ' → ' + (passB ? 'OK' : 'FAIL'),
  '',
  '结论：' + (passA && passB ? 'PASS（系统纪律后创作输出纯正文、提问/评价类不被误杀）' : 'FAIL')
].join('\n')
writeFileSync('/tmp/zj-chat-purity-report.txt', report)
console.log('\nREPORT saved /tmp/zj-chat-purity-report.txt')
rmSync(tmp, { recursive: true, force: true })
process.exit(passA && passB ? 0 : 2)
