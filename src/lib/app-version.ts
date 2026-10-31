import { App } from '@capacitor/app'
import { IS_NATIVE } from './platform'

/** Metadata of the JavaScript bundle being executed, including OTA bundles. */
export const WEB_VERSION = '1.2.146'
export const WEB_BUILD = 146

export type NativeAppVersion = {
  appId: string
  version: string
  build: number
}

let installed: NativeAppVersion | null = null
let reading: Promise<NativeAppVersion | null> | null = null

/** The OS package is authoritative. Updater's `native` field can be overridden by its config. */
export async function getNativeAppVersion(): Promise<NativeAppVersion | null> {
  if (!IS_NATIVE) return null
  if (installed) return installed
  if (reading) return reading
  reading = Promise.resolve().then(async () => {
    try {
      const info = await App.getInfo()
      const build = /^\d+$/.test(String(info.build)) ? Number(info.build) : NaN
      if (!info.id || !info.version || !Number.isSafeInteger(build) || build < 0) return null
      installed = { appId: info.id, version: info.version, build }
      return installed
    } catch {
      return null
    }
  }).finally(() => { reading = null })
  return reading
}

export function knownNativeAppVersion(): NativeAppVersion | null {
  return installed
}
