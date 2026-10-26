// 织卷 electron-builder afterPack hook（macOS）：完整 .app 已生成、DMG 未创建时，
// 对整包做 ad-hoc 签名（codesign --force --deep --sign -）。
// - 覆盖 electron-builder 重打包后失效的 Electron 预置「残缺签名」→ 不再被判「损坏移废纸篓」；
// - 提供可 verify 的签名结构（非 Developer ID / 非公证），配合用户移除 quarantine 即可正常打开。
// 结论来自 blog.margrop.net Gatekeeper unsigned 诊断（ad-hoc 签名优于完全移除签名）。
const path = require('node:path')
const { execFileSync } = require('node:child_process')

exports.default = async function afterPackMacos(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log('[afterPack] 对整包做 ad-hoc 签名（消除残缺签名，非 Developer ID）：' + appPath)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
