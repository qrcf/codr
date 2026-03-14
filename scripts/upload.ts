/**
 * Upload built artifacts to Vercel Blob.
 * Used by CI (GitHub Actions) — reads BLOB_READ_WRITE_TOKEN from process.env.
 *
 * Usage: tsx scripts/upload.ts
 */

import { put } from '@vercel/blob'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dirname, '..')
const distDir = join(root, 'dist')

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const version = pkg.version as string

// Verify DMG exists
const expectedDmg = `Codr-${version}-arm64.dmg`
if (!readdirSync(distDir).includes(expectedDmg)) {
  console.error(`Expected ${expectedDmg} in dist/ but not found.`)
  process.exit(1)
}

// Parse latest-mac.yml for metadata
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
  const dmgPath = join(distDir, expectedDmg)
  console.log(`\nUploading ${expectedDmg} (${(size / 1024 / 1024).toFixed(1)} MB)...`)

  const dmgBlob = await put(`releases/Codr-${version}-arm64.dmg`, readFileSync(dmgPath), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  console.log(`DMG uploaded: ${dmgBlob.downloadUrl}`)

  // Upload latest.json manifest (backward compat)
  const manifest = {
    version,
    dmgUrl: dmgBlob.downloadUrl,
    releasedAt: new Date().toISOString(),
    sha512,
    size,
  }

  const manifestBlob = await put('releases/latest.json', JSON.stringify(manifest, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 1800,
  })

  console.log(`Manifest uploaded: ${manifestBlob.url}`)
  console.log(`\n✓ Uploaded v${version}`)
}

upload()
