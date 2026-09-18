/**
 * IME 组合期守卫（2026-09-18 体验层轮，F-IME-03）：
 * 中文输入法候选确认中（compositionstart ~ compositionend 之间）按下 Enter/Tab 等键时，
 * 该按键属于「确认候选」而非「提交表单」——若应用层在 onKeyDown 里直接执行提交动作，
 * 会把组合态回车误当提交回车，造成误建项目/误重命名/误建档等数据污染
 * （与 Agent 输入框/查找条同族，2026-09-18 05:15 轮收口主干，本轮补齐其余 7 处输入面）。
 * React 合成事件不透传 KeyboardEvent.isComposing，必须读 e.nativeEvent.isComposing
 * （MDN: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing
 *  ——read-only 布尔，true=事件发生在 composition session 内）。
 */
export const isImeComposing = (e: { nativeEvent?: { isComposing?: boolean } }): boolean =>
  e.nativeEvent?.isComposing === true
