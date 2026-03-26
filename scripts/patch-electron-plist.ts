/**
 * Patches the dev Electron.app's Info.plist so deep links (codr://) route to
 * THIS project's Electron binary instead of any other dev Electron app on the system.
 *
 * All Electron dev apps share the generic bundle ID "com.github.Electron".
 * If multiple exist on disk, macOS picks one arbitrarily when resolving a URL scheme.
 * This script gives our copy a unique bundle ID and declares the codr: URL scheme
 * directly in the plist so macOS always resolves to the right binary.
 *
 * Run automatically via postinstall.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const electronApp = resolve(
  import.meta.dirname,
  '../node_modules/electron/dist/Electron.app',
)
const plist = resolve(electronApp, 'Contents/Info.plist')

if (!existsSync(plist)) {
  console.log('Electron.app not found, skipping plist patch')
  process.exit(0)
}

const pb = (cmd: string) =>
  execSync(`/usr/libexec/PlistBuddy -c "${cmd}" "${plist}"`, {
    encoding: 'utf-8',
  }).trim()

const DEV_BUNDLE_ID = 'com.integerstudios.codr.dev'
const PROTOCOL = 'codr'

try {
  const currentId = pb('Print :CFBundleIdentifier')
  if (currentId === DEV_BUNDLE_ID) {
    console.log('Electron.app plist already patched')
    process.exit(0)
  }

  pb(`Set :CFBundleIdentifier ${DEV_BUNDLE_ID}`)
  pb(`Set :CFBundleName Codr Dev`)
  pb(`Set :CFBundleDisplayName Codr Dev`)

  // Add CFBundleURLTypes array with our protocol
  try {
    pb('Print :CFBundleURLTypes')
  } catch {
    pb('Add :CFBundleURLTypes array')
  }
  pb('Add :CFBundleURLTypes:0 dict')
  pb(`Add :CFBundleURLTypes:0:CFBundleURLName string Codr Protocol`)
  pb('Add :CFBundleURLTypes:0:CFBundleURLSchemes array')
  pb(`Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${PROTOCOL}`)

  // Force Launch Services to pick up the change
  execSync(
    `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${electronApp}"`,
  )

  console.log(
    `Patched Electron.app: bundleId=${DEV_BUNDLE_ID}, scheme=${PROTOCOL}://`,
  )
} catch (e) {
  console.error('Failed to patch Electron.app plist:', e)
  process.exit(1)
}
