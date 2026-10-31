import assert from 'node:assert/strict'
import test from 'node:test'
import { files } from './review/reminder-plan-fixtures.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Compile the actual planner with inert platform bridges. This does not run Android or send notifications.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jsonRoot = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json')
const findJar = dir => {
  if (!fs.existsSync(dir)) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const location = path.join(dir, entry.name)
    if (entry.isDirectory()) { const found = findJar(location); if (found) return found }
    else if (/^json-.*\.jar$/.test(entry.name)) return location
  }
  return null
}
const jsonJar = findJar(jsonRoot)

const jdkAvailable = ['javac', 'java'].every(command => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0)
test('actual Java planner control flow with inert Android bridges', { skip: !jsonJar || !jdkAvailable ? 'Requires an installed JDK and an existing Gradle org.json cache; dependencies are never downloaded' : false }, () => {
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ohhu-plan-native-'))
try {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(scratch, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content)
  }
  const classes = path.join(scratch, 'classes'); fs.mkdirSync(classes)
  const actual = ['ReminderPlanStore.java', 'ReminderPlanReceiver.java'].map(name => path.join(root, 'android/app/src/main/java/com/sunshinecampus/app', name))
  actual.push(path.join(root, 'node_modules/@capacitor/local-notifications/android/src/main/java/com/capacitorjs/plugins/localnotifications/CourseReminderPolicy.java'))
  execFileSync('javac', ['-encoding', 'UTF-8', '-classpath', jsonJar, '-d', classes, ...Object.keys(files).map(name => path.join(scratch, name)), ...actual], { stdio: 'pipe' })
  const output = execFileSync('java', ['-classpath', `${classes}${path.delimiter}${jsonJar}`, 'com.sunshinecampus.app.ReminderPlanHarness'], { encoding: 'utf8', stdio: 'pipe' })
  process.stdout.write(output)
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout.toString())
  if (error.stderr) process.stderr.write(error.stderr.toString())
  throw error
} finally {
  // Only remove the mkdtemp directory verified beneath the system temporary directory.
  const target = path.resolve(scratch), tempRoot = path.resolve(os.tmpdir()) + path.sep
  assert.ok(target.startsWith(tempRoot) && path.basename(target).startsWith('ohhu-plan-native-'))
  fs.rmSync(target, { recursive: true, force: true })
}

})
