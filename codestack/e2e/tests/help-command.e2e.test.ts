import { execFileSync } from 'child_process'

import { afterEach, describe, expect, test } from 'bun:test'

import { codestackSession, requirecodestackBinary } from '../utils'

const TEST_TIMEOUT = 60_000

describe('codestack: --help flag', () => {
  test('shows CLI usage information', () => {
    const binary = requirecodestackBinary()
    const output = execFileSync(binary, ['--help'], {
      encoding: 'utf-8',
      timeout: 30_000,
      windowsHide: true,
    })

    // Should show the binary name
    expect(output.toLowerCase()).toContain('codestack')

    // Should show usage info
    expect(output).toMatch(/usage|options|commands/i)
  })

  test('does not reference the paid Codebuff product branding', () => {
    const binary = requirecodestackBinary()
    const output = execFileSync(binary, ['--help'], {
      encoding: 'utf-8',
      timeout: 30_000,
      windowsHide: true,
    })

    // The usage line should say "codestack" not "Use: codebuff"
    expect(output).not.toMatch(/Use: codebuff\b/i)
  })
})

describe('codestack: /help slash command', () => {
  let session: codestackSession | null = null

  afterEach(async () => {
    if (session) {
      await session.stop()
      session = null
    }
  })

  test(
    'shows help content when /help is entered',
    async () => {
      const binary = requirecodestackBinary()
      session = await codestackSession.start(binary)
      await session.waitForReady()

      await session.send('/help')
      const output = await session.capture(2)

      // Should show shortcuts section
      expect(output).toMatch(/shortcut|ctrl|esc/i)
    },
    TEST_TIMEOUT,
  )

  test(
    'does not show subscription commands in help',
    async () => {
      const binary = requirecodestackBinary()
      session = await codestackSession.start(binary)
      await session.waitForReady()

      await session.send('/help')
      const output = await session.capture(2)

      // codestack should NOT show these paid/subscription commands
      // (codestack is BYOK — no account, credits, or subscription)
      expect(output).not.toContain('/subscribe')
      expect(output).not.toContain('/usage')
      expect(output).not.toContain('/credits')
    },
    TEST_TIMEOUT,
  )
})
