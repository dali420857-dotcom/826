import { z } from "zod";
import {
  AuditEventSchema,
  LocalErrorSchema,
  LocalResponseBaseSchema,
  LocalScenarioSchema,
  localScenarios,
} from "../contracts/local";
import type {
  AuditEvent,
  LocalError,
  LocalResponse,
  LocalScenario,
} from "../contracts/local";

export {
  AuditEventSchema,
  LocalErrorSchema,
  LocalResponseBaseSchema,
  LocalScenarioSchema,
  localScenarios,
};
export type { AuditEvent, LocalError, LocalResponse, LocalScenario };

export const RoleSchema = z.enum(["operator", "viewer", "reviewer"]);
export type DemoRole = z.infer<typeof RoleSchema>;

export const ErrorDetailSchema = LocalErrorSchema;
export type ErrorDetail = LocalError;

export const LoadStateSchema = z.enum([
  "idle",
  "loading",
  "success",
  "empty",
  "fallback",
  "error",
  "permission-denied",
  "timeout",
]);

export type LoadState = z.infer<typeof LoadStateSchema>;

export const RouteRegistryEntrySchema = z.object({
  path: z.string().startsWith("/"),
  label_zh_cn: z.string().min(1),
  category: z.enum(["identity", "risk", "operations", "tasks", "workspace"]),
  required_role: RoleSchema,
  fixture_key: z.string().min(1),
  supports_dry_run: z.boolean(),
  page_type: z.enum(["dashboard", "table", "form", "workflow"]),
});

export type RouteRegistryEntry = z.infer<typeof RouteRegistryEntrySchema>;

export const DemoSessionSchema = z.object({
  operator_id: z.literal("local-demo-operator"),
  active_role: RoleSchema,
  roles: z.array(RoleSchema),
  source: z.literal("local-fixture"),
  token_storage: z.literal("disabled"),
});

export type DemoSession = z.infer<typeof DemoSessionSchema>;

export const PageMetricSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  detail: z.string().min(1),
  tone: z.enum(["teal", "amber", "red", "neutral"]),
});

export type PageMetric = z.infer<typeof PageMetricSchema>;

export const PageRecordSchema = z.object({
  id: z.string().min(1),
  primary: z.string().min(1),
  secondary: z.string().min(1),
  status: z.string().min(1),
  owner: z.string().min(1),
  updated_at: z.string().datetime(),
});

export type PageRecord = z.infer<typeof PageRecordSchema>;

export const PageActionSchema = z.object({
  id: z.string().min(1),
  label_zh_cn: z.string().min(1),
  capability: z.string().min(1),
  destructive: z.boolean(),
});

export type PageAction = z.infer<typeof PageActionSchema>;

export const PageDataSchema = z.object({
  page_id: z.string().min(1),
  title_zh_cn: z.string().min(1),
  description_zh_cn: z.string().min(1),
  page_type: z.enum(["dashboard", "table", "form", "workflow"]),
  required_role: RoleSchema,
  metrics: z.array(PageMetricSchema),
  records: z.array(PageRecordSchema),
  actions: z.array(PageActionSchema),
  source: z.enum(["local-fixture", "local-cache"]),
  freshness: z.enum(["fresh", "stale"]),
});

export type PageData = z.infer<typeof PageDataSchema>;

export const PageResponseSchema = LocalResponseBaseSchema.extend({
  data: PageDataSchema.nullable(),
});

export type PageResponse = z.infer<typeof PageResponseSchema>;
