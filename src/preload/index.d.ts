import type { ZhijuanApi } from './index'

declare global {
  interface Window {
    zhijuan: ZhijuanApi
  }
}

export {}
