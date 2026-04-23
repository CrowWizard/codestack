import z from 'zod/v4'

export const CLIENT_ENV_PREFIX = 'NEXT_PUBLIC_'

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_CB_ENVIRONMENT: z.enum(['dev', 'test', 'prod']).default('prod'),
  NEXT_PUBLIC_WEB_PORT: z.coerce.number().min(1000).default(3000),
} satisfies Record<`${typeof CLIENT_ENV_PREFIX}${string}`, any>)
export const clientEnvVars = clientEnvSchema.keyof().options
export type ClientEnvVar = (typeof clientEnvVars)[number]
export type ClientInput = {
  [K in (typeof clientEnvVars)[number]]: string | undefined
}
export type ClientEnv = z.infer<typeof clientEnvSchema>

// Bun will inject all these values, so we need to reference them individually (no for-loops)
export const clientProcessEnv: ClientInput = {
  NEXT_PUBLIC_CB_ENVIRONMENT: process.env.NEXT_PUBLIC_CB_ENVIRONMENT ?? 'prod',
  NEXT_PUBLIC_WEB_PORT: process.env.NEXT_PUBLIC_WEB_PORT ?? '3000',
}
