export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type CorrelationId = Brand<string, 'CorrelationId'>;
export type OperationId = Brand<string, 'OperationId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;
export type ModuleId = 'email' | 'telegram';
export type RuntimeMode = 'monitoring-only';

