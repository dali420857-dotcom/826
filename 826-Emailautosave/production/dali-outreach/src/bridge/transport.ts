import type {
  BridgeEnvelope,
  BridgeRequest,
  OperationName,
} from '../contracts';
import type {
  BridgeConnection,
  BridgeDispatcher,
  BridgeOperationContracts,
  IdempotentMutationOperation,
} from './dispatcher';

export interface BridgeTransport<Contracts extends BridgeOperationContracts> {
  request<Name extends keyof Contracts & OperationName>(
    request: Omit<BridgeRequest, 'operation' | 'payload' | 'idempotencyKey'> & {
      readonly operation: Name;
      readonly payload: Contracts[Name] extends { payload: infer Payload } ? Payload : never;
    } & (Name extends IdempotentMutationOperation
        ? { readonly idempotencyKey: string }
        : { readonly idempotencyKey?: string }),
    connection: BridgeConnection,
  ): Promise<
    BridgeEnvelope<Contracts[Name] extends { result: infer Result } ? Result : never>
  >;
}

export function createBridgeTransport<Contracts extends BridgeOperationContracts>(
  dispatcher: BridgeDispatcher<Contracts>,
): BridgeTransport<Contracts> {
  return {
    async request(request, connection) {
      return dispatcher.request(request, connection) as ReturnType<
        BridgeTransport<Contracts>['request']
      >;
    },
  };
}
