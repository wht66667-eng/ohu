import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan } from './build-multiplatform.mjs'
import { removeFdroidIncompatibleAndroidRefs } from './prepare-fdroid-android.mjs'

test('F-Droid target is limited to the student native app with Capacitor sync', () => {
  const plan = buildPlan('C:/ohu', ['app', '--shell', 'user', '--fdroid'], {})
  assert.equal(plan.target, 'app')
  assert.equal(plan.shell, 'user')
  assert.equal(plan.fdroid, true)
  assert.throws(() => buildPlan('C:/ohu', ['all', '--shell', 'user', '--fdroid'], {}), /app target/)
  assert.throws(() => buildPlan('C:/ohu', ['app', '--shell', 'admin', '--fdroid'], {}), /user shell/)
  assert.throws(() => buildPlan('C:/ohu', ['app', '--shell', 'user', '--fdroid', '--no-sync'], {}), /Capacitor sync/)
})

test('F-Droid Gradle source copy drops only OTA, Talsec, and Google Services plugin references', () => {
  const result = removeFdroidIncompatibleAndroidRefs({
    settings: [
      "include ':capacitor-app'",
      "include ':capgo-capacitor-updater'",
      "project(':capgo-capacitor-updater').projectDir = new File('../node_modules/@capgo/capacitor-updater/android')",
      "include ':capacitor-freerasp'",
      "project(':capacitor-freerasp').projectDir = new File('../node_modules/capacitor-freerasp/android')",
    ].join('\n'),
    capacitorBuild: [
      "implementation project(':capacitor-app')",
      "implementation project(':capgo-capacitor-updater')",
      "implementation project(':capacitor-freerasp')",
    ].join('\n'),
    rootBuild: [
      "classpath 'com.android.tools.build:gradle:8.7.2'",
      "classpath 'com.google.gms:google-services:4.4.2'",
      'maven { url "https://europe-west3-maven.pkg.dev/talsec-artifact-repository/freerasp" }',
      'google()',
    ].join('\n'),
  })
  assert.match(result.settings, /capacitor-app/)
  assert.doesNotMatch(JSON.stringify(result), /capgo-capacitor-updater|capacitor-freerasp|talsec-artifact-repository|com\.google\.gms:google-services/)
  assert.match(result.rootBuild, /com\.android\.tools\.build:gradle/)
  assert.match(result.rootBuild, /google\(\)/)
})
