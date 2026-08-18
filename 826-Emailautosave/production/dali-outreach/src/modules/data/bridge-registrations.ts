import { z } from 'zod';
import type { BridgeHandlerContext, BridgeOperationRegistration } from '../../bridge';
import type { createDataWorkItemModule } from './data-work-item';
import { hashValue } from './hash';
import {
  dataAuditResultSchema,
  dataImportBatchRequestSchema,
  dataImportBatchResultSchema,
  dataPreviewImportRequestSchema,
  dataPreviewSchema,
  listWorkItemsRequestSchema,
  listWorkItemsResultSchema,
  updateWorkItemRequestSchema,
  workItemSchema,
} from './schemas';

type DataService = ReturnType<typeof createDataWorkItemModule>;
function defineRegistration<
  Name extends BridgeOperationRegistration['operation'],
  Payload extends Record<string, unknown>,
  Result,
>(registration: BridgeOperationRegistration<Name, Payload, Result>) {
  return registration;
}

export function createDataBridgeRegistrations(service: DataService) {
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
    const payloadHash = hashValue(JSON.stringify(payload));
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
  const emptyPayloadSchema = z.object({}).strict();

  return [
    defineRegistration({
      operation: 'data.previewImport',
      roles: ['operator'] as const,
      payloadSchema: dataPreviewImportRequestSchema,
      resultSchema: dataPreviewSchema,
      handler: async (payload, context) =>
        runMutation('data.previewImport', payload, context, () =>
          service.previewImport(payload, {
            operationId: context.operationId,
            correlationId: context.correlationId,
          }),
        ),
    }),
    defineRegistration({
      operation: 'data.importBatch',
      roles: ['operator'] as const,
      payloadSchema: dataImportBatchRequestSchema,
      resultSchema: dataImportBatchResultSchema,
      handler: async (payload, context) =>
        runMutation('data.importBatch', payload, context, () =>
          service.importBatch(payload, {
            operationId: context.operationId,
            correlationId: context.correlationId,
          }),
        ),
    }),
    defineRegistration({
      operation: 'data.listWorkItems',
      roles: ['viewer', 'operator', 'approver'] as const,
      payloadSchema: listWorkItemsRequestSchema,
      resultSchema: listWorkItemsResultSchema,
      handler: async (payload) => service.listWorkItems(payload),
    }),
    defineRegistration({
      operation: 'data.updateWorkItem',
      roles: ['operator'] as const,
      payloadSchema: updateWorkItemRequestSchema,
      resultSchema: workItemSchema,
      handler: async (payload, context) =>
        runMutation('data.updateWorkItem', payload, context, () =>
          service.updateWorkItem(payload, {
            operationId: context.operationId,
            correlationId: context.correlationId,
          }),
        ),
    }),
    defineRegistration({
      operation: 'data.readAudit',
      roles: ['viewer', 'operator', 'approver'] as const,
      payloadSchema: emptyPayloadSchema,
      resultSchema: dataAuditResultSchema,
      handler: async () => service.readAudit(),
    }),
  ] as const;
}

export type DataBridgeContracts = {
  [Registration in ReturnType<typeof createDataBridgeRegistrations>[number] as Registration['operation']]: {
    readonly payload: z.infer<Registration['payloadSchema']>;
    readonly result: z.infer<Registration['resultSchema']>;
  };
};
