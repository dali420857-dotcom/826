import { z } from 'zod';

export const bridgeErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'OPERATION_NOT_ALLOWED',
  'IDEMPOTENCY_CONFLICT',
  'APPROVAL_INVALIDATED',
  'RECONCILIATION_REQUIRED',
  'RUNTIME_MODE_REJECTED',
  'INTERNAL_ERROR',
]);

export type BridgeErrorCode = z.infer<typeof bridgeErrorCodeSchema>;

export type BridgeEnvelope<T> =
  | { schemaVersion: 1; status: 'ok'; correlationId: string; data: T }
  | {
      schemaVersion: 1;
      status: 'error';
      correlationId: string;
      error: { code: BridgeErrorCode; message: string; retryable: boolean };
    };

export const bridgeEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('status', [
    z.object({
      schemaVersion: z.literal(1),
      status: z.literal('ok'),
      correlationId: z.string().min(1).max(128),
      data,
    }),
    z.object({
      schemaVersion: z.literal(1),
      status: z.literal('error'),
      correlationId: z.string().min(1).max(128),
      error: z.object({
        code: bridgeErrorCodeSchema,
        message: z.string().min(1).max(240),
        retryable: z.boolean(),
      }),
    }),
  ]);

