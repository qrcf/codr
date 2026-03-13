import { config } from 'dotenv'
import { put } from '@vercel/blob'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const root = join(import.meta.dirname, '..')

// Load .env.prod (then .env as fallback) so electron-builder can pick up APPLE_ID, etc.
config({ path: join(root, '.env.prod') })
config({ path: join(root, '.env') })

const distDir = join(root, 'dist')
const pkgPath = join(root, 'package.json')
const args = process.argv.slice(2)
const shouldUpload = args.includes('--upload')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
let version = pkg.version as string

// Version bump only when uploading
if (shouldUpload) {
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
  if (shouldUpload) {
    console.error(
      `\nBuild failed. Version was bumped to ${version} in package.json but nothing was uploaded.\nFix the build and re-run, or revert the version.`
    )
  } else {
    console.error('\nBuild failed.')
  }
  process.exit(1)
}

console.log(`\n✓ Built v${version}`)

if (!shouldUpload) {
  process.exit(0)
}

// --- Upload ---

const expectedDmg = `Codr-${version}-arm64.dmg`
const dmgFile = readdirSync(distDir).includes(expectedDmg) ? expectedDmg : null
if (!dmgFile) {
  console.error(`Expected ${expectedDmg} in dist/ but not found.`)
  process.exit(1)
}

const ymlPath = join(distDir, 'latest-mac.yml')
const yml = readFileSync(ymlPath, 'utf-8')
const sha512 = yml.match(/sha512:\s*(.+)/)?.[1]?.trim() ?? ''
const size = parseInt(yml.match(/size:\s*(\d+)/)?.[1] ?? '0', 10)

async function upload(): Promise<void> {
  // Upload ZIP (for auto-updater)
  const zipFile = `Codr-${version}-arm64-mac.zip`
  const zipPath = join(distDir, zipFile)
  if (existsSync(zipPath)) {
    console.log(`\nUploading ${zipFile}...`)
    const zipBlob = await put(`releases/${zipFile}`, readFileSync(zipPath), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    console.log(`ZIP uploaded: ${zipBlob.downloadUrl}`)

    // Upload ZIP blockmap (for differential updates)
    const blockmapFile = `${zipFile}.blockmap`
    const blockmapPath = join(distDir, blockmapFile)
    if (existsSync(blockmapPath)) {
      await put(`releases/${blockmapFile}`, readFileSync(blockmapPath), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
      })
      console.log(`Blockmap uploaded: ${blockmapFile}`)
    }
  } else {
    console.warn(`Warning: ${zipFile} not found in dist/ — auto-updater won't work`)
  }

  // Upload latest-mac.yml (electron-updater checks this)
  console.log('Uploading latest-mac.yml...')
  await put('releases/latest-mac.yml', readFileSync(ymlPath), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/yaml',
    cacheControlMaxAge: 300,
  })
  console.log('latest-mac.yml uploaded')

  // Upload DMG (for manual downloads)
  const dmgPath = join(distDir, dmgFile!)
  console.log(`\nUploading ${dmgFile} (${(size / 1024 / 1024).toFixed(1)} MB)...`)

  const dmgBlob = await put(`releases/Codr-${version}-arm64.dmg`, readFileSync(dmgPath), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true
  })

  console.log(`DMG uploaded: ${dmgBlob.downloadUrl}`)

  // Upload latest.json manifest (backward compat)
  const manifest = {
    version,
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
  console.log(`\n✓ Deployed v${version}`)
  console.log(`\nDon't forget to commit: git add package.json && git commit -m "v${version}"`)
}

upload()
