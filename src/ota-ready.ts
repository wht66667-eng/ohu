/** Importing this module does not confirm an update. A usable screen must mount first. */
import { IS_NATIVE } from './lib/platform'
import { confirmCurrentOtaBundle } from './lib/live-update'

let confirmation: Promise<void> | null = null
let confirmed = false

/** Safe to call from a root-screen effect, including React StrictMode's repeated effects. */
export async function confirmOtaAppReady(): Promise<void> {
  if (!IS_NATIVE || confirmed) return
  if (confirmation) return confirmation
  confirmation = confirmCurrentOtaBundle().then(() => {
    confirmed = true
  }).catch((error: unknown) => {
    console.info('[ota] readiness confirmation failed; a later screen may retry', error)
  }).finally(() => { confirmation = null })
  return confirmation
}
