import type { Plugin } from 'vite'

export function localStudentDownload(root: string): Plugin
export function latestLocalStudentRelease(root: string): {
  source: string
  release: {
    app: string
    shell: 'user'
    packageName: string
    nativeVersion: string
    nativeBuild: number
    size: number
    sha256: string
    abi: 'arm64-v8a'
    minSdkVersion: number
    url: string
    localPreview: true
  }
}
