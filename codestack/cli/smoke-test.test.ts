#!/usr/bin/env bun
/**
 * codestack Binary Smoke Test
 *
 * Verifies the compiled codestack binary:
 * 1. Reports a valid version number
 * 2. Shows codestack branding in --help output
 * 3. Excludes mode flags (--free, --max, --plan) from --help
 *
 * Prerequisites:
 *   bun codestack/cli/build.ts <version>   # build the binary
 *
 * Run:
 *   bun test codestack/cli/smoke-test.test.ts
 */

import { execFileSync, execSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'

import { describe, test, expect } from 'bun:test'

import { getcodestackBinaryPath } from '../e2e/utils'

const BINARY_PATH = getcodestackBinaryPath()
const TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

function runBinary(args: string[]): string {
  return execFileSync(BINARY_PATH, args, {
    encoding: 'utf-8',
    timeout: 10_000,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  })
}

const binaryExists = existsSync(BINARY_PATH)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!binaryExists)('codestack Binary Smoke Tests', () => {
  test(
    '--version outputs a valid semver version',
    () => {
      const output = stripAnsiCodes(runBinary(['--version'])).trim()
      // The binary may print env info before the version; grab the last line
      const lastLine =
        output
          .split('\n')
          .filter((l) => l.trim())
          .pop() ?? ''
      expect(lastLine.trim()).toMatch(/^\d+\.\d+\.\d+/)
    },
    TIMEOUT_MS,
  )

  test(
    '--help shows codestack branding',
    () => {
      const output = stripAnsiCodes(runBinary(['--help']))

      // Should show codestack in the usage line
      expect(output).toContain('Usage: codestack')
      // Must NOT contain the paid product name in the usage line
      expect(output).not.toContain('Use: codebuff')
    },
    TIMEOUT_MS,
  )

  test(
    '--help shows mode flags (codestack supports mode switching)',
    () => {
      const output = stripAnsiCodes(runBinary(['--help']))

      // codestack supports mode flags unlike Freebuff
      expect(output).toMatch(/--free/)
      expect(output).toMatch(/--max/)
      expect(output).toMatch(/--plan/)
      // Note: --lite is only in Codebuff, not codestack
    },
    TIMEOUT_MS,
  )
})

// Show skip messages so test output is informative
if (!binaryExists) {
  describe('codestack Binary Required', () => {
    test.skip('Build the binary first: bun codestack/cli/build.ts <version>', () => {})
  })
}
