import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'

const root = join(import.meta.dirname, '..')

// --- Parse args ---

const args = process.argv.slice(2)
const allFlag = args.includes('--all')
const dryRun = args.includes('--dry-run')
const tags = args.filter((a) => !a.startsWith('--'))

if (!allFlag && tags.length === 0) {
  console.error(
    'Usage: pnpm backfill-changelog <tag...> | --all [--dry-run]\n\nExamples:\n  pnpm backfill-changelog v0.3.2\n  pnpm backfill-changelog v0.3.1 v0.3.2\n  pnpm backfill-changelog --all\n  pnpm backfill-changelog --all --dry-run'
  )
  process.exit(1)
}

// --- Helpers ---

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

check('gh CLI required (brew install gh)', 'which gh')
check('claude CLI required', 'which claude')

// --- Tag utilities ---

function getAllTags(): string[] {
  return run('git tag --sort=-version:refname')
    .split('\n')
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
}

function getPreviousTag(tag: string, allTags: string[]): string {
  const idx = allTags.indexOf(tag)
  if (idx === -1) throw new Error(`Tag ${tag} not found`)
  if (idx === allTags.length - 1) {
    // Oldest tag — use root commit
    return run('git rev-list --max-parents=0 HEAD')
  }
  return allTags[idx + 1]
}

function getReleaseBody(tag: string): string | null {
  try {
    return run(`gh release view ${tag} --json body --jq '.body'`)
  } catch {
    return null // no release for this tag
  }
}

function isBodyEmpty(body: string): boolean {
  const trimmed = body.trim()
  if (!trimmed) return true
  if (/^\*\*Full Changelog\*\*:/.test(trimmed)) return true
  return false
}

function getCommitsBetween(fromRef: string, toRef: string): string {
  return run(`git log ${fromRef}..${toRef} --pretty=format:"%h %s" --no-merges`)
}

// --- Changelog cache ---

const cacheDir = join(tmpdir(), 'codr-changelog-cache')

function cacheKey(tag: string, commitLog: string): string {
  return createHash('sha256').update(`backfill\n${tag}\n${commitLog}`).digest('hex').slice(0, 16)
}

function getCachedChangelog(tag: string, commitLog: string): string | null {
  const path = join(cacheDir, `${cacheKey(tag, commitLog)}.md`)
  if (existsSync(path)) return readFileSync(path, 'utf-8')
  return null
}

function cacheChangelog(tag: string, commitLog: string, content: string) {
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, `${cacheKey(tag, commitLog)}.md`), content)
}

// --- Changelog generation ---

function generateChangelog(
  tag: string,
  previousTag: string,
  commitLog: string,
  extraInstruction?: string,
  previousChangelog?: string
): string {
  const version = tag.replace(/^v/, '')
  const parts = [
    `Generate a concise changelog in markdown for version ${version} of Codr (a desktop AI coding assistant).`,
    `Group changes under categories like Features, Fixes, Improvements, etc. Only include categories that have entries.`,
    `Do not include a heading with the version number. Keep it brief and scannable.`,
    `Output ONLY the markdown changelog. No preamble, no commentary, no intro sentences — start directly with the first category heading.`,
    `\nCommits since ${previousTag}:\n`,
    commitLog,
  ]
  if (previousChangelog && extraInstruction) {
    parts.push(`\nHere is the previous changelog to revise:\n${previousChangelog}`)
    parts.push(`\nRevision instructions: ${extraInstruction}`)
  }

  console.log(`Generating changelog for ${tag}...\n`)

  const result = spawnSync('claude', ['-p', parts.join(' ')], {
    encoding: 'utf-8',
    timeout: 120_000,
    cwd: root,
  })

  if (result.status !== 0) {
    console.error(`✗ Claude CLI failed for ${tag}:`, result.stderr || result.error)
    process.exit(1)
  }

  const content = result.stdout.trim()
  cacheChangelog(tag, commitLog, content)
  return content
}

// --- Interactive approval ---

async function approveChangelog(
  tag: string,
  previousTag: string,
  commitLog: string,
  initialChangelog: string
): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let current = initialChangelog

  while (true) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Changelog for ${tag} (since ${previousTag}):`)
    console.log('─'.repeat(60))
    console.log(current)
    console.log('─'.repeat(60) + '\n')

    const answer = await rl.question('(a)pprove / (s)kip / (q)uit / or type instructions to regenerate: ')
    const choice = answer.trim()

    if (choice.toLowerCase() === 'a') {
      rl.close()
      return current
    }
    if (choice.toLowerCase() === 's') {
      rl.close()
      return null
    }
    if (choice.toLowerCase() === 'q') {
      rl.close()
      process.exit(0)
    }
    current = generateChangelog(tag, previousTag, commitLog, choice || undefined, current)
  }
}

// --- Apply changelog to release ---

function applyChangelog(tag: string, changelog: string) {
  console.log(`Updating release ${tag}...`)
  const result = spawnSync('gh', ['release', 'edit', tag, '--notes', changelog], {
    stdio: 'inherit',
    cwd: root,
  })
  if (result.status !== 0) {
    console.error(`✗ Failed to update release ${tag}`)
    process.exit(1)
  }
  console.log(`✓ Release ${tag} updated`)
}

// --- Main ---

const allTags = getAllTags()
let tagsToProcess: string[]

if (allFlag) {
  tagsToProcess = []
  for (const tag of allTags) {
    const body = getReleaseBody(tag)
    if (body === null) continue // no release exists
    if (isBodyEmpty(body)) tagsToProcess.push(tag)
  }

  if (tagsToProcess.length === 0) {
    console.log('All releases already have changelogs.')
    process.exit(0)
  }

  console.log(`Found ${tagsToProcess.length} release(s) needing changelogs: ${tagsToProcess.join(', ')}`)

  if (dryRun) process.exit(0)
} else {
  for (const tag of tags) {
    if (!allTags.includes(tag)) {
      console.error(`✗ Tag ${tag} not found`)
      process.exit(1)
    }
    if (getReleaseBody(tag) === null) {
      console.error(`✗ No GitHub release found for tag ${tag}`)
      process.exit(1)
    }
  }
  tagsToProcess = tags
}

// Sort oldest-first (allTags is descending, so reverse the order)
tagsToProcess.sort((a, b) => {
  const ai = allTags.indexOf(a)
  const bi = allTags.indexOf(b)
  return bi - ai
})

let updated = 0

for (const tag of tagsToProcess) {
  const previousTag = getPreviousTag(tag, allTags)
  const commitLog = getCommitsBetween(previousTag, tag)

  if (!commitLog) {
    console.log(`\nNo commits found between ${previousTag} and ${tag}, skipping.`)
    continue
  }

  console.log(`\n${previousTag} → ${tag}`)

  // Warn if overwriting existing content
  if (!allFlag) {
    const existingBody = getReleaseBody(tag)
    if (existingBody && !isBodyEmpty(existingBody)) {
      console.log(`⚠ Release ${tag} already has notes (will be replaced if approved)`)
    }
  }

  const cached = getCachedChangelog(tag, commitLog)
  const changelog = cached ?? generateChangelog(tag, previousTag, commitLog)
  if (cached) console.log('Using cached changelog')

  const approved = await approveChangelog(tag, previousTag, commitLog, changelog)
  if (approved === null) {
    console.log(`Skipped ${tag}`)
    continue
  }

  applyChangelog(tag, approved)
  updated++
}

console.log(`\nDone. Updated ${updated} release(s).`)
