#!/usr/bin/env bash
# 织卷 macOS 签名审计（移植自 ZhuLinsen/daily_stock_analysis scripts/macos-signature-audit.sh）
# 背景：Electron 官方 .app 自带预置签名，electron-builder 重打包/重命名后成为「残缺签名」
#      （spctl：code has no resources but signature indicates they must be present）。
#      macOS 对携带残缺签名比无签名更严 → 直接判「已阻止恶意软件并移到废纸篓」。
# 方案：normalize 模式递归清理所有失效签名，得到干净无签名 app；check 模式用于验收 fail-fast。
set -euo pipefail

mode="${1:-}"
artifact_root="${2:-}"

if [[ "${mode}" != "normalize" ]] && [[ "${mode}" != "check" ]]; then
  echo "Usage: $0 <normalize|check> <artifact-path>" >&2
  exit 2
fi
if [[ -z "${artifact_root}" ]] || [[ ! -e "${artifact_root}" ]]; then
  echo "ERROR: 签名审计目标不存在: ${artifact_root:-<empty>}" >&2
  exit 2
fi
command -v codesign >/dev/null 2>&1 || { echo "ERROR: 需要 codesign" >&2; exit 2; }
command -v file >/dev/null 2>&1 || { echo "ERROR: 需要 file" >&2; exit 2; }

checked_count=0
signed_count=0
removed_count=0

remove_broken_signature() {
  local candidate="$1"
  echo "WARNING: 移除 unsigned 产物中的残缺签名: ${candidate}"
  codesign --remove-signature "${candidate}"
  removed_count=$((removed_count + 1))
  local details
  details="$(codesign -d "${candidate}" 2>&1 || true)"
  if [[ "${details}" != *"code object is not signed at all"* ]]; then
    echo "ERROR: 移除失败: ${candidate}" >&2
    echo "${details}" >&2
    exit 1
  fi
}

audit_candidate() {
  local candidate="$1"
  local details=""
  checked_count=$((checked_count + 1))
  if ! details="$(codesign -d "${candidate}" 2>&1)"; then
    if [[ "${details}" == *"code object is not signed at all"* ]]; then
      return 0
    fi
    if [[ "${mode}" == "normalize" ]]; then
      remove_broken_signature "${candidate}"
      return 0
    fi
    echo "ERROR: 签名不可读/无效: ${candidate}" >&2
    echo "${details}" >&2
    exit 1
  fi
  signed_count=$((signed_count + 1))
  if codesign --verify --strict --verbose=4 "${candidate}" >/dev/null 2>&1; then
    return 0
  fi
  if [[ "${mode}" == "normalize" ]]; then
    remove_broken_signature "${candidate}"
    return 0
  fi
  echo "ERROR: 签名无效: ${candidate}" >&2
  codesign --verify --strict --verbose=4 "${candidate}" || true
  exit 1
}

while IFS= read -r -d '' candidate; do
  if [[ -d "${candidate}" ]]; then
    audit_candidate "${candidate}"
  elif file -b "${candidate}" | grep -q "Mach-O"; then
    audit_candidate "${candidate}"
  fi
done < <(
  find "${artifact_root}" -depth \
    \( -type f -o -type d \( -name "*.app" -o -name "*.framework" -o -name "*.xpc" \) \) \
    -print0
)

echo "macOS 签名审计完成: mode=${mode}, checked=${checked_count}, signed=${signed_count}, removed=${removed_count}"
