import { z } from "zod";

/**
 * Scenarios are deterministic local fixture modes. They intentionally do not
 * describe provider state or a remote authentication state.
 */
export const localScenarios = [
  "success",
  "empty",
  "error",
  "permission-denied",
  "timeout",
  "fallback",
] as const;

export const LocalScenarioSchema = z.enum(localScenarios);
export type LocalScenario = z.infer<typeof LocalScenarioSchema>;

export const localResponseStatuses = ["success", "warning", "error"] as const;
export const LocalResponseStatusSchema = z.enum(localResponseStatuses);
export type LocalResponseStatus = z.infer<typeof LocalResponseStatusSchema>;

export const localAuditDecisions = [
  "allowed",
  "fallback",
  "denied",
  "timeout",
  "error",
] as const;
export const LocalAuditDecisionSchema = z.enum(localAuditDecisions);
export type LocalAuditDecision = z.infer<typeof LocalAuditDecisionSchema>;

export const localErrorCodes = [
  "PERMISSION_DENIED",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "INVALID_DATA",
  "SAFE_STOP",
] as const;
export const LocalErrorCodeSchema = z.enum(localErrorCodes);
export type LocalErrorCode = z.infer<typeof LocalErrorCodeSchema>;

export const LocalErrorSchema = z.object({
  code: LocalErrorCodeSchema,
  message: z.string().min(1),
  details: z.unknown().optional(),
});
export type LocalError = z.infer<typeof LocalErrorSchema>;

/**
 * The audit envelope is deliberately provider-neutral. Optional dry-run
 * fields let local capabilities prove that no external mutation occurred
 * without making read-only responses pretend to be mutations.
 */
export const LocalAuditSchema = z.object({
  event_id: z.string().min(1),
  timestamp: z.string().datetime(),
  actor: z.string().min(1),
  capability: z.string().min(1),
  resource_scope: z.string().min(1),
  decision: LocalAuditDecisionSchema,
  dry_run: z.boolean().optional(),
  mutation_applied: z.boolean().optional(),
  readback: z.string().min(1).optional(),
});
export type LocalAudit = z.infer<typeof LocalAuditSchema>;
// Compatibility aliases keep existing domain components readable while the
// canonical local envelope remains the only runtime audit schema.
export const AuditEventSchema = LocalAuditSchema;
export type AuditEvent = LocalAudit;

export const DryRunAuditSchema = LocalAuditSchema.extend({
  dry_run: z.literal(true),
  mutation_applied: z.literal(false),
  readback: z.literal("local-simulation"),
});
export type DryRunAudit = z.infer<typeof DryRunAuditSchema>;

export interface LocalResponse<T> {
  status: LocalResponseStatus;
  summary: string;
  next_actions: string[];
  artifacts: Record<string, unknown>;
  audit: LocalAudit;
  data: T | null;
  error?: LocalError;
}

export const LocalResponseBaseSchema = z.object({
  status: LocalResponseStatusSchema,
  summary: z.string().min(1),
  next_actions: z.array(z.string()),
  artifacts: z.record(z.string(), z.unknown()),
  audit: LocalAuditSchema,
  error: LocalErrorSchema.optional(),
});

/**
 * Build a runtime validator for a page-specific LocalResponse. Domain
 * modules own their data schema; the envelope remains shared and stable.
 */
export function createLocalResponseSchema<T>(dataSchema: z.ZodType<T>) {
  return LocalResponseBaseSchema.extend({ data: dataSchema.nullable() });
}

export function isDryRunAudit(audit: LocalAudit): audit is DryRunAudit {
  return (
    audit.dry_run === true &&
    audit.mutation_applied === false &&
    audit.readback === "local-simulation"
  );
}
