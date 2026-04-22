#!/usr/bin/env bun

/**
 * codestack CLI build script.
 *
 * Wraps the existing CLI build-binary.ts with codestack_MODE=true
 * to produce a local BYOK variant of the Codebuff CLI.
 *
 * Usage:
 *   bun codestack/cli/build.ts <version>
 *
 * Example:
 *   bun codestack/cli/build.ts 1.0.0
 */

import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const version = process.argv[2]
if (!version) {
  console.error('Usage: bun codestack/cli/build.ts <version>')
  process.exit(1)
}

console.log(`Building codestack v${version}...`)

const result = spawnSync(
  'bun',
  ['cli/scripts/build-binary.ts', 'codestack', version],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      codestack_MODE: 'true',
      NEXT_PUBLIC_CB_ENVIRONMENT: 'prod',
    },
  },
)

if (result.status !== 0) {
  console.error('codestack build failed')
  process.exit(result.status ?? 1)
}

console.log(`✅ codestack v${version} built successfully`)
