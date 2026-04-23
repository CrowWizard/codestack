/**
 * Agent-driven E2E test for Freebuff.
 *
 * Uses the Codebuff SDK to run a testing agent that interacts with the
 * Freebuff CLI binary via tmux custom tools.
 */

import { afterEach, describe, expect, test } from 'bun:test'

import { freebuffTesterAgent } from '../agent/freebuff-tester'
import { createFreebuffTmuxTools, requireFreebuffBinary } from '../utils'

import type { CodebuffClient as CodebuffClientType } from '@codebuff/sdk'

const AGENT_TEST_TIMEOUT = 180_000

describe('Freebuff: Agent-driven E2E', () => {
  let cleanup: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (cleanup) {
      await cleanup()
      cleanup = null
    }
  })

  test(
    'agent can start freebuff and verify startup behavior',
    async () => {
      const binary = requireFreebuffBinary()
      const tmuxTools = createFreebuffTmuxTools(binary)
      cleanup = tmuxTools.cleanup

      // Dynamically import SDK to avoid build-time dependency issues
      const { CodebuffClient } = (await import(
        '@codebuff/sdk'
      )) as typeof import('@codebuff/sdk')

      const client: CodebuffClientType = new CodebuffClient({})

      const events: Array<{ type: string; [key: string]: unknown }> = []

      const result = await client.run({
        agent: freebuffTesterAgent.id,
        prompt:
          'Start Freebuff using the start_freebuff tool. Then capture the output ' +
          'with capture_freebuff_output (waitSeconds: 3). Verify that:\n' +
          '1. The CLI started without errors (no FATAL, panic, or crash messages)\n' +
          '2. The output has visible content (not a blank screen)\n' +
          'Finally, call stop_freebuff to clean up. Report your findings.',
        agentDefinitions: [freebuffTesterAgent],
        customToolDefinitions: tmuxTools.tools,
        handleEvent: (event) => {
          events.push(event)
        },
      })

      expect(result.output.type).not.toBe('error')

      // Verify the agent used the tmux tools
      const toolCalls = events.filter((e) => e.type === 'tool_call')
      const toolNames = toolCalls.map((e) => e.toolName)
      expect(toolNames).toContain('start_freebuff')
      expect(toolNames).toContain('capture_freebuff_output')
      expect(toolNames).toContain('stop_freebuff')
    },
    AGENT_TEST_TIMEOUT,
  )

  test(
    'agent can send commands and verify output',
    async () => {
      const binary = requireFreebuffBinary()
      const tmuxTools = createFreebuffTmuxTools(binary)
      cleanup = tmuxTools.cleanup

      const { CodebuffClient } = (await import(
        '@codebuff/sdk'
      )) as typeof import('@codebuff/sdk')

      const client: CodebuffClientType = new CodebuffClient({})

      const result = await client.run({
        agent: freebuffTesterAgent.id,
        prompt:
          'Start Freebuff, wait for it to load (capture with waitSeconds: 5), ' +
          'then send the "/help" command using send_to_freebuff. ' +
          'Capture the output after 2 seconds. ' +
          'Verify the help content is displayed. ' +
          'Stop Freebuff when done and report your findings.',
        agentDefinitions: [freebuffTesterAgent],
        customToolDefinitions: tmuxTools.tools,
        handleEvent: () => {},
      })

      expect(result.output.type).not.toBe('error')
    },
    AGENT_TEST_TIMEOUT,
  )
})
