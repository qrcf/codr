import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'

const root = join(import.meta.dirname, '..')

// --- Parse args ---

const args = process.argv.slice(2)
const bump = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : args.includes('--patch') ? 'patch' : null

if (!bump) {
  console.error('Usage: pnpm release --major | --minor | --patch')
  process.exit(1)
}

// --- Preflight checks ---

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', cwd: root }).trim()
}

function check(label: string, cmd: string) {
  try {
    execSync(cmd, { stdio: 'ignore' })
  } catch {
    console.error(`✗ ${label}`)
    process.exit(1)
  }
}

check('Working tree must be clean', 'git diff --quiet && git diff --cached --quiet')
check('gh CLI required (brew install gh)', 'which gh')
check('claude CLI required', 'which claude')

// --- Resolve version ---

const latestTag = run('git describe --tags --abbrev=0')
const currentVersion = latestTag.replace(/^v/, '')
const [major, minor, patch] = currentVersion.split('.').map(Number)

const newVersion =
  bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`

const newTag = `v${newVersion}`

// Check tag doesn't already exist
const existingTag = run(`git tag -l "${newTag}"`)
if (existingTag) {
  console.error(`✗ Tag ${newTag} already exists`)
  process.exit(1)
}

console.log(`\n${latestTag} → ${newTag} (${bump})\n`)

// --- Gather commits ---

const commitLog = run(`git log ${latestTag}..HEAD --pretty=format:"%h %s" --no-merges`)

if (!commitLog) {
  console.error('✗ No commits since last tag')
  process.exit(1)
}

// --- Changelog generation with cache ---

const cacheDir = join(tmpdir(), 'codr-changelog-cache')
const cacheKey = createHash('sha256').update(`${newVersion}\n${commitLog}`).digest('hex').slice(0, 16)
const cachePath = join(cacheDir, `${cacheKey}.md`)

function getCachedChangelog(): string | null {
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf-8')
  return null
}

function cacheChangelog(content: string) {
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cachePath, content)
}

function generateChangelog(extraInstruction?: string, previousChangelog?: string): string {
  const parts = [
    `Generate a concise changelog in markdown for version ${newVersion} of Codr (a desktop AI coding assistant).`,
    `Group changes under categories like Features, Fixes, Improvements, etc. Only include categories that have entries.`,
    `Do not include a heading with the version number. Keep it brief and scannable.`,
    `Output ONLY the markdown changelog. No preamble, no commentary, no intro sentences — start directly with the first category heading.`,
    `\nCommits since ${latestTag}:\n`,
    commitLog,
  ]
  if (previousChangelog && extraInstruction) {
    parts.push(`\nHere is the previous changelog to revise:\n${previousChangelog}`)
    parts.push(`\nRevision instructions: ${extraInstruction}`)
  }

  console.log('Generating changelog...\n')

  const result = spawnSync('claude', ['-p', parts.join(' ')], {
    encoding: 'utf-8',
    timeout: 120_000,
    cwd: root,
  })

  if (result.status !== 0) {
    console.error('✗ Claude CLI failed:', result.stderr || result.error)
    process.exit(1)
  }

  const content = result.stdout.trim()
  cacheChangelog(content)
  return content
}

// --- Interactive approval loop ---

const rl = createInterface({ input: process.stdin, output: process.stdout })
let changelog = getCachedChangelog() ?? ''
let fromCache = !!changelog

if (!fromCache) changelog = generateChangelog()

while (true) {
  if (fromCache) console.log('Using cached changelog\n')
  fromCache = false

  console.log('─'.repeat(60))
  console.log(changelog)
  console.log('─'.repeat(60) + '\n')

  const answer = await rl.question('(a)pprove / (q)uit / or type instructions to regenerate: ')
  const choice = answer.trim()

  if (choice.toLowerCase() === 'a') break
  if (choice.toLowerCase() === 'q') {
    console.log('Aborted.')
    rl.close()
    process.exit(0)
  }
  changelog = generateChangelog(choice || undefined, changelog)
}

rl.close()

// --- Update package.json ---

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

if (pkg.version !== newVersion) {
  pkg.version = newVersion
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  execSync('git add package.json', { stdio: 'inherit', cwd: root })
  execSync(`git commit -m "${newTag}"`, { stdio: 'inherit', cwd: root })
} else {
  console.log('package.json already at target version, skipping commit')
}

// --- Tag, push, and create draft release ---

execSync(`git tag ${newTag}`, { cwd: root })

console.log('Pushing...')
execSync(`git push origin HEAD ${newTag}`, { stdio: 'inherit', cwd: root })

console.log(`\nCreating draft release ${newTag}...`)

const gh = spawnSync('gh', ['release', 'create', newTag, '--draft', '--title', newTag, '--notes', changelog], {
  stdio: 'inherit',
  cwd: root,
})

if (gh.status !== 0) {
  console.error('✗ Failed to create draft release')
  process.exit(1)
}

console.log(`\n✓ Release ${newTag} initiated`)
console.log(`  Draft: https://github.com/qrcf/codr/releases/tag/${newTag}`)
console.log(`  CI will build, sign, notarize, and publish.\n`)
