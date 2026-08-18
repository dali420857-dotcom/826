import { delay, http, HttpResponse } from "msw";
import {
  FraudScenarioSchema,
  type AuditEvent,
  type FraudOverview,
  type FraudResponse,
  type FraudScenario,
} from "../core/fraud/contracts";
import {
  LocalScenarioSchema,
  type LocalScenario,
} from "../core/contracts/local";
import type { PageData, PageResponse } from "../core/mock/contracts";
import { pageFixtures } from "../core/mock/page-fixtures";
import { routeRegistryByFixture } from "../core/mock/route-registry";
import {
  identityFixtures,
  type IdentityFixtureId,
} from "../core/fixtures/identity";
import {
  getOperationsFixture,
  type OperationsRecord,
} from "../core/fixtures/operations";
import { getTaskFixture } from "../core/fixtures/tasks";

const observedAt = "2026-08-15T18:00:00.000Z";
const responseAt = "2026-08-15T18:00:05.000Z";

function domainPageData(pageId: string): PageData | undefined {
  const base = pageFixtures[pageId];
  if (!base) return undefined;

  const identity = identityFixtures[pageId as IdentityFixtureId];
  if (identity) {
    return {
      ...base,
      title_zh_cn: identity.title_zh_cn,
      description_zh_cn: identity.description_zh_cn,
      required_role: identity.required_role,
      metrics: identity.metrics.map((metric) => ({
        label: metric.label_zh_cn,
        value: metric.value,
        detail: metric.detail_zh_cn,
        tone: metric.tone,
      })),
      records: identity.records.map((record, index) => ({
        id: record.id,
        primary: record.title_zh_cn,
        secondary: record.detail_zh_cn,
        status: record.status_zh_cn,
        owner: index === 0 ? "operator" : "reviewer",
        updated_at: `2026-08-15T17:${String(20 - index * 5).padStart(2, "0")}:00.000Z`,
      })),
      actions: base.actions,
    };
  }

  const operations = getOperationsFixture(pageId);
  if (operations) {
    return {
      ...base,
      title_zh_cn: operations.title_zh_cn,
      description_zh_cn: operations.description_zh_cn,
      records: operations.records.map((record: OperationsRecord) => ({
        id: record.id,
        primary: record.name,
        secondary: record.detail,
        status: record.status_label_zh_cn,
        owner: record.owner,
        updated_at: record.updated_at,
      })),
    };
  }

  const task = getTaskFixture(pageId);
  if (task) {
    return {
      ...base,
      title_zh_cn: task.title_zh_cn,
      description_zh_cn: task.description_zh_cn,
      page_type: task.page_type,
      required_role: task.required_role,
      metrics: task.metrics.map((metric) => ({ ...metric })),
      records: task.records.map((record) => ({ ...record })),
      actions: task.actions.map((action) => ({ ...action })),
    };
  }

  return base;
}

const successSignals: FraudOverview["signals"] = [
  {
    id: "signal-001",
    subject: "Account cluster A-17",
    signal: "Repeated device fingerprint across new accounts",
    severity: "high",
    observed_at: observedAt,
    action: "hold",
  },
  {
    id: "signal-002",
    subject: "Session group S-04",
    signal: "Unusual sign-in rhythm outside the local baseline",
    severity: "medium",
    observed_at: "2026-08-15T17:42:00.000Z",
    action: "review",
  },
  {
    id: "signal-003",
    subject: "Account cluster A-09",
    signal: "Proxy quality dropped below the review threshold",
    severity: "low",
    observed_at: "2026-08-15T17:24:00.000Z",
    action: "monitor",
  },
];

function audit(
  decision: AuditEvent["decision"],
  scenario: FraudScenario,
): AuditEvent {
  return {
    event_id: `audit-${scenario}`,
    timestamp: responseAt,
    actor: "local-user",
    capability: "inspect_fraud_overview",
    resource_scope: "local-fixture",
    decision,
  };
}

function overview(
  signals: FraudOverview["signals"],
  overrides: Partial<FraudOverview> = {},
): FraudOverview {
  return {
    window: "Last 24 hours",
    total_reviewed: signals.length === 0 ? 0 : 1284,
    risk_score: signals.length === 0 ? 0 : 42,
    blocked_count: signals.filter((signal) => signal.action === "hold").length,
    review_count: signals.filter((signal) => signal.action === "review").length,
    signals,
    source: "local-fixture",
    freshness: "fresh",
    ...overrides,
  };
}

function successResponse(scenario: FraudScenario): FraudResponse {
  return {
    status: "success",
    summary: "Fraud review signals loaded from a local fixture.",
    next_actions: [
      "Review high-severity signals before any approved operation.",
    ],
    artifacts: { source: "local-fixture", scenario },
    audit: audit("allowed", scenario),
    data: overview(successSignals),
  };
}

function emptyResponse(): FraudResponse {
  return {
    status: "success",
    summary: "No fraud signals matched the local review window.",
    next_actions: ["Keep monitoring the next review window."],
    artifacts: { source: "local-fixture", scenario: "empty" },
    audit: audit("allowed", "empty"),
    data: overview([]),
  };
}

function fallbackResponse(): FraudResponse {
  return {
    status: "warning",
    summary: "Provider unavailable; showing a stale local read-only snapshot.",
    next_actions: [
      "Do not start a mutation while the provider is unavailable.",
      "Revalidate provider health before requesting a fresh readback.",
    ],
    artifacts: {
      source: "local-cache",
      scenario: "fallback",
      cache_age: "11 minutes",
      mutations_allowed: false,
    },
    audit: audit("fallback", "fallback"),
    data: overview(successSignals.slice(0, 2), {
      source: "local-cache",
      freshness: "stale",
      risk_score: 39,
    }),
  };
}

function errorResponse(scenario: "error" | "permission-denied"): FraudResponse {
  const permissionDenied = scenario === "permission-denied";
  return {
    status: "error",
    summary: permissionDenied
      ? "The local policy denied this observation scope."
      : "The local fixture returned a provider error.",
    next_actions: permissionDenied
      ? ["Request the observation scope from an authorized operator."]
      : ["Retry once after checking local fixture health."],
    artifacts: { source: "local-fixture", scenario },
    audit: audit(permissionDenied ? "denied" : "error", scenario),
    data: null,
    error: {
      code: permissionDenied ? "PERMISSION_DENIED" : "PROVIDER_ERROR",
      message: permissionDenied
        ? "Observation scope is not approved for this session."
        : "The fixture intentionally simulated a provider failure.",
    },
  };
}

function pageAudit(
  pageId: string,
  decision: PageResponse["audit"]["decision"],
  scenario: LocalScenario,
): PageResponse["audit"] {
  return {
    event_id: `audit-${pageId}-${scenario}`,
    timestamp: responseAt,
    actor: "local-demo-operator",
    capability: `inspect_${pageId}`,
    resource_scope: "local-fixture",
    decision,
  };
}

function pageResponse(
  pageId: string,
  scenario: LocalScenario,
  data: PageData | null,
  overrides: Partial<PageResponse> = {},
): PageResponse {
  const entry = routeRegistryByFixture.get(pageId);
  return {
    status: "success",
    summary: `${entry?.label_zh_cn ?? pageId} 已从本地 fixture 载入。`,
    next_actions: [
      "只使用本地样本继续检查页面状态。",
      "真实账号、付款、Telegram 与生产 API 仍保持关闭。",
    ],
    artifacts: { source: "local-fixture", scenario, page_id: pageId },
    audit: pageAudit(pageId, "allowed", scenario),
    data,
    ...overrides,
  };
}

function pageEmptyResponse(pageId: string, data: PageData): PageResponse {
  return pageResponse(
    pageId,
    "empty",
    { ...data, metrics: [], records: [] },
    {
      summary: "当前筛选条件没有本地样本。",
      next_actions: ["放宽筛选条件，或切回 success 场景继续检查。"],
      artifacts: {
        source: "local-fixture",
        scenario: "empty",
        page_id: pageId,
      },
    },
  );
}

function pageFallbackResponse(pageId: string, data: PageData): PageResponse {
  return pageResponse(
    pageId,
    "fallback",
    { ...data, source: "local-cache", freshness: "stale" },
    {
      status: "warning",
      summary: "本地 provider 不可用，正在显示只读缓存。",
      next_actions: ["暂停所有 dry-run 之外的动作。", "恢复前先重新验证读回。"],
      artifacts: {
        source: "local-cache",
        scenario: "fallback",
        page_id: pageId,
        mutations_allowed: false,
      },
      audit: pageAudit(pageId, "fallback", "fallback"),
    },
  );
}

function pageErrorResponse(
  pageId: string,
  scenario: "error" | "permission-denied",
): PageResponse {
  const denied = scenario === "permission-denied";
  return pageResponse(pageId, scenario, null, {
    status: "error",
    summary: denied
      ? "当前演示角色没有访问权限。"
      : "本地 fixture 模拟服务错误。",
    next_actions: denied
      ? ["切换到具备权限的本地演示角色。"]
      : ["检查本地 mock handler 后重试一次。"],
    artifacts: { source: "local-fixture", scenario, page_id: pageId },
    audit: pageAudit(pageId, denied ? "denied" : "error", scenario),
    error: {
      code: denied ? "PERMISSION_DENIED" : "PROVIDER_ERROR",
      message: denied
        ? "当前本地演示角色不能查看该页面。"
        : "本地 fixture 已按场景返回错误。",
    },
  });
}

export const handlers = [
  http.get("/api/mock/pages/:pageId", async ({ request }) => {
    const url = new URL(request.url);
    const pathPageId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    const pageId = url.searchParams.get("pageId") ?? pathPageId;
    const data = domainPageData(pageId);
    const requested = url.searchParams.get("scenario") ?? "success";
    const scenario = LocalScenarioSchema.safeParse(requested).success
      ? (requested as LocalScenario)
      : "success";

    if (!data) {
      return HttpResponse.json(pageErrorResponse("unknown", "error"), {
        status: 404,
      });
    }
    if (scenario === "timeout") {
      await delay(1_500);
      return HttpResponse.json(pageResponse(pageId, "timeout", data));
    }
    if (scenario === "empty") {
      return HttpResponse.json(pageEmptyResponse(pageId, data));
    }
    if (scenario === "fallback") {
      return HttpResponse.json(pageFallbackResponse(pageId, data));
    }
    if (scenario === "error" || scenario === "permission-denied") {
      return HttpResponse.json(pageErrorResponse(pageId, scenario), {
        status: scenario === "permission-denied" ? 403 : 500,
      });
    }

    return HttpResponse.json(pageResponse(pageId, "success", data));
  }),

  http.get("/api/preventing-fraud/overview", async ({ request }) => {
    const requested =
      new URL(request.url).searchParams.get("scenario") ?? "success";
    const scenario = FraudScenarioSchema.safeParse(requested).success
      ? (requested as FraudScenario)
      : "success";

    if (scenario === "timeout") {
      await delay(1_500);
      return HttpResponse.json(successResponse("timeout"));
    }
    if (scenario === "empty") {
      return HttpResponse.json(emptyResponse());
    }
    if (scenario === "fallback") {
      return HttpResponse.json(fallbackResponse());
    }
    if (scenario === "error" || scenario === "permission-denied") {
      return HttpResponse.json(errorResponse(scenario), {
        status: scenario === "permission-denied" ? 403 : 500,
      });
    }

    return HttpResponse.json(successResponse("success"));
  }),
];
