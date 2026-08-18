import { z } from "zod";
import { inspectFraudOverview } from "../core/fraud/service";
import { inspectMockPage } from "../core/mock/service";
import {
  FraudScenarioSchema,
  type FraudResponse,
  type FraudScenario,
} from "../core/fraud/contracts";
import {
  LocalScenarioSchema,
  type DryRunAudit,
  type LocalScenario,
} from "../core/contracts/local";
import type { PageResponse } from "../core/mock/contracts";
import { pageFixtures } from "../core/mock/page-fixtures";
import { getRouteEntryByFixture } from "../shared/route-registry";
import {
  createDemoSession,
  demoRoles,
  roleCanAccess,
} from "../stores/demo-session";
import { getTaskFixture } from "../core/fixtures/tasks";

const InspectFraudOverviewInputSchema = z.object({
  scenario: FraudScenarioSchema,
});

export type InspectFraudOverviewInput = z.infer<
  typeof InspectFraudOverviewInputSchema
>;

/**
 * Explicit capability contract used by the UI and future agent-control clients.
 * It is observation-only, requires a fresh readback, and never mutates external state.
 */
export async function runInspectFraudOverview(
  input: InspectFraudOverviewInput,
): Promise<FraudResponse> {
  const validated = InspectFraudOverviewInputSchema.parse(input);
  return inspectFraudOverview(validated);
}

export const inspectFraudOverviewCapability = {
  id: "inspect_fraud_overview",
  classification: "observation",
  mutating: false,
  readback: "required",
  approval: "none",
} as const satisfies Record<string, string | boolean>;

export type { FraudScenario };

const InspectMockPageInputSchema = z.object({
  pageId: z.string().min(1),
  scenario: LocalScenarioSchema,
});

export type InspectMockPageInput = z.infer<typeof InspectMockPageInputSchema>;

export async function runInspectMockPage(
  input: InspectMockPageInput,
): Promise<PageResponse> {
  const validated = InspectMockPageInputSchema.parse(input);
  return inspectMockPage(validated);
}

const LocalDryRunInputSchema = z.object({
  pageId: z.string().min(1),
  actionId: z.string().min(1),
  scenario: LocalScenarioSchema,
  role: z.enum(demoRoles),
});

export type LocalDryRunInput = z.infer<typeof LocalDryRunInputSchema>;

export interface LocalDryRunReceipt {
  status: "success";
  summary: string;
  next_actions: string[];
  artifacts: Record<string, unknown>;
  audit: DryRunAudit;
  dry_run: true;
  mutation_applied: false;
  readback: "local-simulation";
}

function actionIsAllowed(pageId: string, actionId: string): boolean {
  const genericAction = pageFixtures[pageId]?.actions.some(
    (action) => action.id === actionId,
  );
  const taskAction = getTaskFixture(pageId)?.actions.some(
    (action) => action.id === actionId,
  );
  return Boolean(genericAction || taskAction);
}

export function runLocalDryRun(input: LocalDryRunInput): LocalDryRunReceipt {
  const validated = LocalDryRunInputSchema.parse(input);
  const route = getRouteEntryByFixture(validated.pageId);
  if (
    !route ||
    !route.supports_dry_run ||
    !actionIsAllowed(validated.pageId, validated.actionId) ||
    !roleCanAccess(validated.role, route.required_role)
  ) {
    throw new Error("本地 dry-run 范围或角色不符合当前 route contract。");
  }

  const session = createDemoSession(validated.role);
  const audit: DryRunAudit = {
    event_id: `dry-run-${validated.pageId}-${validated.actionId}`,
    timestamp: new Date().toISOString(),
    actor: session.actor_id,
    capability: validated.actionId,
    resource_scope: validated.pageId,
    decision: "allowed",
    dry_run: true,
    mutation_applied: false,
    readback: "local-simulation",
  };

  return {
    status: "success",
    summary: "本地 dry-run 已完成；没有外部请求或真实变更。",
    next_actions: ["检查审计回执。", "需要真实集成时先提供授权与测试环境。"],
    artifacts: {
      source: "local-simulation",
      scenario: validated.scenario,
      mutation_applied: false,
    },
    audit,
    dry_run: true,
    mutation_applied: false,
    readback: "local-simulation",
  };
}

export const inspectMockPageCapability = {
  id: "inspect_mock_page",
  classification: "observation",
  mutating: false,
  readback: "required",
  approval: "none",
} as const satisfies Record<string, string | boolean>;

export const localDryRunCapability = {
  id: "local_dry_run",
  classification: "diagnostics",
  mutating: false,
  dry_run: true,
  readback: "local-simulation",
  approval: "none",
} as const satisfies Record<string, string | boolean>;

export {
  HermesResearchReceiptSchema,
  HermesResearchRequestSchema,
  hermesResearchCoordinatorCapability,
  validateHermesResearchReceipt,
} from "./hermes-research";
export type {
  HermesResearchReceipt,
  HermesResearchRequest,
} from "./hermes-research";

export type { LocalScenario };
