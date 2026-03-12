import { config } from 'dotenv'
import { put } from '@vercel/blob'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const root = join(import.meta.dirname, '..')

// Load .env.prod (then .env as fallback) so electron-builder can pick up APPLE_ID, etc.
config({ path: join(root, '.env.prod') })
config({ path: join(root, '.env') })
const distDir = join(root, 'dist')
const pkgPath = join(root, 'package.json')

// Parse CLI flags
const args = process.argv.slice(2)
const bump = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch'

// Read and bump version
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

const nextVersion =
  bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`

console.log(`\nBumping version: ${pkg.version} → ${nextVersion} (${bump})\n`)

pkg.version = nextVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// Build
console.log('Building...\n')
try {
  execSync('pnpm dist', { stdio: 'inherit', cwd: root })
} catch {
  console.error(
    `\nBuild failed. Version was bumped to ${nextVersion} in package.json but nothing was uploaded.\nFix the build and re-run, or revert the version.`
  )
  process.exit(1)
}

// Find the DMG matching the version we just built
const expectedDmg = `Codr-${nextVersion}-arm64.dmg`
const dmgFile = readdirSync(distDir).includes(expectedDmg) ? expectedDmg : null
if (!dmgFile) {
  console.error(`Expected ${expectedDmg} in dist/ but not found.`)
  process.exit(1)
}

// Parse latest-mac.yml for sha512 and size
const ymlPath = join(distDir, 'latest-mac.yml')
const yml = readFileSync(ymlPath, 'utf-8')
const sha512 = yml.match(/sha512:\s*(.+)/)?.[1]?.trim() ?? ''
const size = parseInt(yml.match(/size:\s*(\d+)/)?.[1] ?? '0', 10)

async function upload(): Promise<void> {
  // Upload DMG
  const dmgPath = join(distDir, dmgFile!)
  console.log(`\nUploading ${dmgFile} (${(size / 1024 / 1024).toFixed(1)} MB)...`)

  const dmgBlob = await put(`releases/Codr-${nextVersion}-arm64.dmg`, readFileSync(dmgPath), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true
  })

  console.log(`DMG uploaded: ${dmgBlob.downloadUrl}`)

  // Upload latest.json manifest
  const manifest = {
    version: nextVersion,
    dmgUrl: dmgBlob.downloadUrl,
    releasedAt: new Date().toISOString(),
    sha512,
    size
  }

  const manifestBlob = await put('releases/latest.json', JSON.stringify(manifest, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 1800
  })

  console.log(`Manifest uploaded: ${manifestBlob.url}`)
  console.log(`\n✓ Deployed v${nextVersion}`)
  console.log(`\nDon't forget to commit: git add package.json && git commit -m "v${nextVersion}"`)
}

upload()
