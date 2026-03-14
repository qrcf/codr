import { config } from 'dotenv'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const root = join(import.meta.dirname, '..')

// Load .env.prod (then .env as fallback) so electron-builder can pick up APPLE_ID, etc.
config({ path: join(root, '.env.prod') })
config({ path: join(root, '.env') })

const pkgPath = join(root, 'package.json')
const args = process.argv.slice(2)

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
let version = pkg.version as string

// Version bump
const hasBump = args.includes('--major') || args.includes('--minor') || args.includes('--patch')
if (hasBump) {
  const bump = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch'
  const [major, minor, patch] = version.split('.').map(Number)
  version =
    bump === 'major'
      ? `${major + 1}.0.0`
      : bump === 'minor'
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`

  console.log(`\nBumping version: ${pkg.version} → ${version} (${bump})\n`)
  pkg.version = version
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

// Build
console.log('Building...\n')
try {
  execSync('tsx scripts/download-uv.ts', { stdio: 'inherit', cwd: root })
  execSync('electron-vite build', { stdio: 'inherit', cwd: root })
  execSync('electron-builder', { stdio: 'inherit', cwd: root })
} catch {
  console.error('\nBuild failed.')
  process.exit(1)
}

console.log(`\n✓ Built v${version}`)
