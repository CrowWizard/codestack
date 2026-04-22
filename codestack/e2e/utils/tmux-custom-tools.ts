import { z } from 'zod/v4'

import { codestackSession } from './codestack-session'

import type { ZodType } from 'zod/v4'

interface codestackToolDefinition {
  toolName: string
  description: string
  inputSchema: ZodType
  endsAgentStep: boolean
  exampleInputs: Record<string, unknown>[]
  execute: (input: Record<string, unknown>) => Promise<ToolOutput>
}

type ToolOutput = { type: 'json'; value: Record<string, unknown> }[]

/**
 * Creates custom tool definitions that allow a Codebuff SDK agent
 * to interact with a codestack CLI binary via tmux.
 *
 * Returns the tools array and a cleanup function to call in afterEach.
 *
 * Usage:
 * ```ts
 * const { tools, cleanup } = createcodestackTmuxTools(binaryPath)
 * // ... pass tools to client.run({ customToolDefinitions: tools })
 * // ... in afterEach: await cleanup()
 * ```
 */
export function createcodestackTmuxTools(binaryPath: string): {
  tools: codestackToolDefinition[]
  cleanup: () => Promise<void>
} {
  let session: codestackSession | null = null

  const startTool: codestackToolDefinition = {
    toolName: 'start_codestack',
    description:
      'Start the codestack CLI binary in a tmux terminal session. Call this first before interacting with codestack.',
    inputSchema: z.object({}),
    endsAgentStep: true,
    exampleInputs: [{}],
    execute: async (): Promise<ToolOutput> => {
      if (session) {
        return [
          {
            type: 'json',
            value: {
              error: 'Session already running',
              sessionName: session.name,
            },
          },
        ]
      }
      session = await codestackSession.start(binaryPath)
      await session.waitForReady()
      const initialOutput = await session.capture()
      return [
        {
          type: 'json',
          value: {
            started: true,
            sessionName: session.name,
            initialOutput,
          },
        },
      ]
    },
  }

  const sendInputTool: codestackToolDefinition = {
    toolName: 'send_to_codestack',
    description:
      'Send text input to the running codestack CLI. The text is sent as if typed by the user and Enter is pressed.',
    inputSchema: z.object({
      text: z.string().describe('Text to send to codestack'),
    }),
    endsAgentStep: false,
    exampleInputs: [{ text: '/help' }],
    execute: async (input): Promise<ToolOutput> => {
      const text = (input as { text: string }).text
      if (!session) {
        return [
          {
            type: 'json',
            value: { error: 'No session running. Call start_codestack first.' },
          },
        ]
      }
      await session.send(text)
      return [{ type: 'json', value: { sent: true, text } }]
    },
  }

  const captureOutputTool: codestackToolDefinition = {
    toolName: 'capture_codestack_output',
    description:
      'Capture the current terminal output from the running codestack CLI session. ' +
      'Use waitSeconds to wait before capturing (useful after sending a command).',
    inputSchema: z.object({
      waitSeconds: z
        .number()
        .optional()
        .describe('Seconds to wait before capturing (default: 0)'),
    }),
    endsAgentStep: true,
    exampleInputs: [{ waitSeconds: 2 }],
    execute: async (input): Promise<ToolOutput> => {
      const waitSeconds = (input as { waitSeconds?: number }).waitSeconds
      if (!session) {
        return [
          {
            type: 'json',
            value: { error: 'No session running. Call start_codestack first.' },
          },
        ]
      }
      const output = await session.capture(waitSeconds)
      return [{ type: 'json', value: { output } }]
    },
  }

  const stopTool: codestackToolDefinition = {
    toolName: 'stop_codestack',
    description:
      'Stop the running codestack CLI session and clean up resources. Always call this when done testing.',
    inputSchema: z.object({}),
    endsAgentStep: true,
    exampleInputs: [{}],
    execute: async (): Promise<ToolOutput> => {
      if (!session) {
        return [{ type: 'json', value: { stopped: true, wasRunning: false } }]
      }
      await session.stop()
      session = null
      return [{ type: 'json', value: { stopped: true, wasRunning: true } }]
    },
  }

  const cleanup = async () => {
    if (session) {
      await session.stop()
      session = null
    }
  }

  return {
    tools: [startTool, sendInputTool, captureOutputTool, stopTool],
    cleanup,
  }
}
