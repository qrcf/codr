/**
 * Download the uv binary for the current platform.
 * Run as: tsx scripts/download-uv.ts
 *
 * Downloads from https://github.com/astral-sh/uv/releases/latest
 * and extracts the binary to resources/bin/uv.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const RESOURCES_BIN = join(import.meta.dirname, '..', 'resources', 'bin')

function getPlatformTarget(): string {
  const arch = process.arch
  const platform = process.platform

  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu'
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu'

  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

function main() {
  const uvPath = join(RESOURCES_BIN, 'uv')

  // Skip if already downloaded
  if (existsSync(uvPath)) {
    console.log(`[download-uv] uv binary already exists at ${uvPath}, skipping.`)
    return
  }

  const target = getPlatformTarget()
  const tarball = `uv-${target}.tar.gz`
  const url = `https://github.com/astral-sh/uv/releases/latest/download/${tarball}`

  console.log(`[download-uv] Downloading uv for ${target}...`)

  mkdirSync(RESOURCES_BIN, { recursive: true })

  // Download and extract in one step
  execSync(
    `curl -fsSL "${url}" | tar xz -C "${RESOURCES_BIN}" --strip-components=1 "uv-${target}/uv"`,
    { stdio: 'inherit' }
  )

  chmodSync(uvPath, 0o755)

  console.log(`[download-uv] uv binary saved to ${uvPath}`)
}

main()
