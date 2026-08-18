import { z } from "zod";

export const fraudScenarios = [
  "success",
  "empty",
  "error",
  "permission-denied",
  "timeout",
  "fallback",
] as const;

export const FraudScenarioSchema = z.enum(fraudScenarios);
export type FraudScenario = z.infer<typeof FraudScenarioSchema>;

export const FraudSignalSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  signal: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  observed_at: z.string().datetime(),
  action: z.enum(["monitor", "review", "hold"]),
});

export type FraudSignal = z.infer<typeof FraudSignalSchema>;

export const FraudOverviewSchema = z.object({
  window: z.string().min(1),
  total_reviewed: z.number().int().nonnegative(),
  risk_score: z.number().min(0).max(100),
  blocked_count: z.number().int().nonnegative(),
  review_count: z.number().int().nonnegative(),
  signals: z.array(FraudSignalSchema),
  source: z.enum(["local-fixture", "local-cache"]),
  freshness: z.enum(["fresh", "stale"]),
});

export type FraudOverview = z.infer<typeof FraudOverviewSchema>;

export const AuditEventSchema = z.object({
  event_id: z.string().min(1),
  timestamp: z.string().datetime(),
  actor: z.literal("local-user"),
  capability: z.literal("inspect_fraud_overview"),
  resource_scope: z.literal("local-fixture"),
  decision: z.enum(["allowed", "fallback", "denied", "timeout", "error"]),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const ErrorDetailSchema = z.object({
  code: z.enum([
    "PERMISSION_DENIED",
    "PROVIDER_ERROR",
    "TIMEOUT",
    "INVALID_DATA",
  ]),
  message: z.string().min(1),
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const FraudResponseSchema = z.object({
  status: z.enum(["success", "warning", "error"]),
  summary: z.string().min(1),
  next_actions: z.array(z.string()),
  artifacts: z.record(z.string(), z.unknown()),
  audit: AuditEventSchema,
  data: FraudOverviewSchema.nullable(),
  error: ErrorDetailSchema.optional(),
});

export type FraudResponse = z.infer<typeof FraudResponseSchema>;

export type FraudLoadState =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "fallback"
  | "error"
  | "permission-denied"
  | "timeout";
