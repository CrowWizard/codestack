/**
 * Agent-driven E2E test for codestack.
 *
 * Uses the Codebuff SDK to run a testing agent that interacts with the
 * codestack CLI binary via tmux custom tools.
 */

import { afterEach, describe, expect, test } from 'bun:test'

import { codestackTesterAgent } from '../agent/codestack-tester'
import { createcodestackTmuxTools, requirecodestackBinary } from '../utils'

import type { CodebuffClient as CodebuffClientType } from '@codebuff/sdk'

const AGENT_TEST_TIMEOUT = 180_000

describe('codestack: Agent-driven E2E', () => {
  let cleanup: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (cleanup) {
      await cleanup()
      cleanup = null
    }
  })

  test(
    'agent can start codestack and verify startup behavior',
    async () => {
      const binary = requirecodestackBinary()
      const tmuxTools = createcodestackTmuxTools(binary)
      cleanup = tmuxTools.cleanup

      // Dynamically import SDK to avoid build-time dependency issues
      const { CodebuffClient } =
        (await import('@codebuff/sdk')) as typeof import('@codebuff/sdk')

      const client: CodebuffClientType = new CodebuffClient({})

      const events: Array<{ type: string; [key: string]: unknown }> = []

      const result = await client.run({
        agent: codestackTesterAgent.id,
        prompt:
          'Start codestack using the start_codestack tool. Then capture the output ' +
          'with capture_codestack_output (waitSeconds: 3). Verify that:\n' +
          '1. The CLI started without errors (no FATAL, panic, or crash messages)\n' +
          '2. The output has visible content (not a blank screen)\n' +
          'Finally, call stop_codestack to clean up. Report your findings.',
        agentDefinitions: [codestackTesterAgent],
        customToolDefinitions: tmuxTools.tools,
        handleEvent: (event) => {
          events.push(event)
        },
      })

      expect(result.output.type).not.toBe('error')

      // Verify the agent used the tmux tools
      const toolCalls = events.filter((e) => e.type === 'tool_call')
      const toolNames = toolCalls.map((e) => e.toolName)
      expect(toolNames).toContain('start_codestack')
      expect(toolNames).toContain('capture_codestack_output')
      expect(toolNames).toContain('stop_codestack')
    },
    AGENT_TEST_TIMEOUT,
  )

  test(
    'agent can send commands and verify output',
    async () => {
      const binary = requirecodestackBinary()
      const tmuxTools = createcodestackTmuxTools(binary)
      cleanup = tmuxTools.cleanup

      const { CodebuffClient } =
        (await import('@codebuff/sdk')) as typeof import('@codebuff/sdk')

      const client: CodebuffClientType = new CodebuffClient({})

      const result = await client.run({
        agent: codestackTesterAgent.id,
        prompt:
          'Start codestack, wait for it to load (capture with waitSeconds: 5), ' +
          'then send the "/help" command using send_to_codestack. ' +
          'Capture the output after 2 seconds. ' +
          'Verify the help content is displayed. ' +
          'Stop codestack when done and report your findings.',
        agentDefinitions: [codestackTesterAgent],
        customToolDefinitions: tmuxTools.tools,
        handleEvent: () => {},
      })

      expect(result.output.type).not.toBe('error')
    },
    AGENT_TEST_TIMEOUT,
  )
})
