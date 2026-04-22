import z from 'zod/v4'

export const CLIENT_ENV_PREFIX = 'NEXT_PUBLIC_'

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_CB_ENVIRONMENT: z.enum(['dev', 'test', 'prod']),
  NEXT_PUBLIC_CODEBUFF_APP_URL: z.url().min(1),
  NEXT_PUBLIC_SUPPORT_EMAIL: z.email().min(1),
  NEXT_PUBLIC_WEB_PORT: z.coerce.number().min(1000),
} satisfies Record<`${typeof CLIENT_ENV_PREFIX}${string}`, any>)
export const clientEnvVars = clientEnvSchema.keyof().options
export type ClientEnvVar = (typeof clientEnvVars)[number]
export type ClientInput = {
  [K in (typeof clientEnvVars)[number]]: string | undefined
}
export type ClientEnv = z.infer<typeof clientEnvSchema>

// Bun will inject all these values, so we need to reference them individually (no for-loops)
export const clientProcessEnv: ClientInput = {
  NEXT_PUBLIC_CB_ENVIRONMENT: process.env.NEXT_PUBLIC_CB_ENVIRONMENT,
  NEXT_PUBLIC_CODEBUFF_APP_URL: process.env.NEXT_PUBLIC_CODEBUFF_APP_URL,
  NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_WEB_PORT: process.env.NEXT_PUBLIC_WEB_PORT,
}
