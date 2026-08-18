import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type {
  BridgeHandlerContext,
  BridgeOperationRegistration,
} from '../../bridge';
import type { createEmailOutreachModule } from './email-outreach';
import {
  approvalResultSchema,
  approveDraftRequestSchema,
  createDraftRequestSchema,
  draftViewSchema,
  enqueueRequestSchema,
  enqueueResultSchema,
  importPreviewSchema,
  importRequestSchema,
  reconcileRequestSchema,
  reviseDraftRequestSchema,
} from './schemas';

type EmailService = ReturnType<typeof createEmailOutreachModule>;

function defineRegistration<
  Name extends BridgeOperationRegistration['operation'],
  Payload extends Record<string, unknown>,
  Result,
>(registration: BridgeOperationRegistration<Name, Payload, Result>) {
  return registration;
}

export function createEmailBridgeRegistrations(service: EmailService) {
  const mutations = new Map<
    string,
    { operation: string; payloadHash: string; promise: Promise<unknown> }
  >();
  const runMutation = async <Result>(
    operation: string,
    payload: Record<string, unknown>,
    context: BridgeHandlerContext,
    execute: () => Result | Promise<Result>,
  ): Promise<Result> => {
    if (!context.idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload), 'utf8')
      .digest('hex');
    const existing = mutations.get(context.idempotencyKey);
    if (existing) {
      if (existing.operation !== operation || existing.payloadHash !== payloadHash) {
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      return existing.promise as Promise<Result>;
    }
    const promise = Promise.resolve().then(execute);
    mutations.set(context.idempotencyKey, { operation, payloadHash, promise });
    return promise;
  };

  return [
    defineRegistration({
      operation: 'email.previewImport',
      roles: ['operator'],
      payloadSchema: importRequestSchema,
      resultSchema: importPreviewSchema,
      handler: async (payload, context) =>
        runMutation('email.previewImport', payload, context, () =>
          service.previewImport(payload, {
            operationId: context.operationId,
            correlationId: context.correlationId,
          }),
        ),
    }),
    defineRegistration({
      operation: 'email.createDraft',
      roles: ['operator'],
      payloadSchema: createDraftRequestSchema,
      resultSchema: draftViewSchema,
      handler: async (payload, context) =>
        runMutation('email.createDraft', payload, context, () =>
          service.createDraft(payload, {
            operationId: context.operationId,
            correlationId: context.correlationId,
          }),
        ),
    }),
    defineRegistration({
      operation: 'email.reviseDraft',
      roles: ['operator'],
      payloadSchema: reviseDraftRequestSchema,
      resultSchema: draftViewSchema,
      handler: async (payload, context) =>
        runMutation('email.reviseDraft', payload, context, () =>
          service.reviseDraft(payload, {
            operationId: context.operationId,
            correlationId: context.correlationId,
          }),
        ),
    }),
    defineRegistration({
      operation: 'email.approveDraft',
      roles: ['approver'],
      payloadSchema: approveDraftRequestSchema,
      resultSchema: approvalResultSchema,
      handler: async (payload, context) =>
        runMutation('email.approveDraft', payload, context, () =>
          service.approveDraft(payload, {
            operationId: context.operationId,
            correlationId: context.correlationId,
          }),
        ),
    }),
    defineRegistration({
      operation: 'email.enqueueLocal',
      roles: ['operator'],
      payloadSchema: enqueueRequestSchema.omit({ operationId: true, idempotencyKey: true }),
      resultSchema: enqueueResultSchema,
      handler: async (payload, context) => {
        if (!context.idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
        return service.enqueueLocal(
          {
            ...payload,
            operationId: context.operationId,
            idempotencyKey: context.idempotencyKey,
          },
          { correlationId: context.correlationId },
        );
      },
    }),
    defineRegistration({
      operation: 'email.reconcile',
      roles: ['operator'],
      payloadSchema: reconcileRequestSchema.omit({ operationId: true }),
      resultSchema: enqueueResultSchema,
      handler: async (payload, context) =>
        runMutation('email.reconcile', payload, context, () =>
          service.reconcile(
            { ...payload, operationId: context.operationId },
            { correlationId: context.correlationId },
          ),
        ),
    }),
  ] as const;
}

export type EmailBridgeContracts = {
  [Registration in ReturnType<typeof createEmailBridgeRegistrations>[number] as Registration['operation']]: {
    readonly payload: z.infer<Registration['payloadSchema']>;
    readonly result: z.infer<Registration['resultSchema']>;
  };
};
