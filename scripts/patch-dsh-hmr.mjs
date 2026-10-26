#!/usr/bin/env node
// 织卷 · dsh-runtime 引擎启动补丁（2026-10-26 修复「no adapter registered for provider」根因）
// 背景：dsh-app-boot 的 watchUserPatches 调 hmr.registerConfig(...)，但激活的
//      @deepseek-ai/cordis-plugin-hmr(1.0.20) 无 registerConfig 方法 → 引擎注册 LLM 适配器前崩溃退出
//      → dsh-llm 报 no adapter（setting 引擎离线）。给 dsh-app-boot 注入 registerConfig 守卫跳过 HMR，
//      引擎随后正常注册 zj-* 路由（子代理实测：注入后引擎可启动并真正请求 DeepSeek）。
// 幂等：已存在守卫则跳过；dsh-runtime 被重装/覆盖后重打包会自动重新注入。
// 位置：放 electron-builder 打包前调用（npm build 前置）；dsh-runtime 本身 gitignore。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')

if (!existsSync(target)) {
  console.log('[patch-dsh-hmr] 未找到 dsh-app-boot 文件，跳过（dsh-runtime 未安装？）')
  process.exit(0)
}
let src = readFileSync(target, 'utf8')
if (src.includes('typeof hmr.registerConfig !== "function"')) {
  console.log('[patch-dsh-hmr] registerConfig 守卫已存在，跳过')
  process.exit(0)
}
const needle = 'const register = hmr.registerConfig(filename,'
if (!src.includes(needle)) {
  console.log('[patch-dsh-hmr] 未找到注入点，请检查 dsh-app-boot 版本，跳过')
  process.exit(0)
}
src = src.replace(needle, 'if (typeof hmr.registerConfig !== "function") return async () => {};\n\t' + needle)
writeFileSync(target, src)
console.log('[patch-dsh-hmr] 已注入 registerConfig 守卫（修复 NO_ADAPTER）')
