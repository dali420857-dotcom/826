import { z } from 'zod';

export const phaseZeroRuntimeSchema = z.object({
  mode: z.literal('monitoring-only'),
  providerAdapters: z.tuple([]),
  liveSend: z.literal(false),
  allowedOrigins: z
    .array(z.string().url().refine((value) => new URL(value).hostname === '127.0.0.1'))
    .min(1)
    .max(4),
});

export const bridgeAccessContextSchema = z.object({
  host: z.string().regex(/^127\.0\.0\.1:\d{2,5}$/),
  origin: z.string().url().refine((value) => new URL(value).hostname === '127.0.0.1'),
  processCapability: z.string().min(32).max(256),
  role: z.enum(['viewer', 'operator', 'approver']),
});

export const inputLimits = Object.freeze({
  maxImportBytes: 1_000_000,
  maxImportRows: 2_000,
  maxBodyCharacters: 50_000,
  maxTargetsPerPreview: 500,
  maxPageSize: 100,
  maxConcurrentOperations: 4,
});

export function assertSafeCsvCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
