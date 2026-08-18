import { defineStore } from "pinia";
import { LocalApiError } from "../adapters/local-api";
import {
  runInspectMockPage,
  runLocalDryRun,
  type LocalDryRunReceipt,
} from "../agent-control/capabilities";
import type { DemoRole } from "./demo-session";
import type { AuditEvent, LocalScenario } from "../core/contracts/local";
import type { LoadState, PageResponse } from "../core/mock/contracts";

interface LoadError {
  code: "PERMISSION_DENIED" | "PROVIDER_ERROR" | "TIMEOUT" | "INVALID_DATA";
  message: string;
}

interface PageState {
  pageId: string | null;
  scenario: LocalScenario;
  state: LoadState;
  response: PageResponse | null;
  error: LoadError | null;
  audit: AuditEvent | null;
  receipt: LocalDryRunReceipt | null;
  requestSerial: number;
}

function fallbackAudit(
  pageId: string,
  scenario: LocalScenario,
  decision: AuditEvent["decision"],
): AuditEvent {
  return {
    event_id: `audit-${pageId}-${scenario}-local`,
    timestamp: new Date().toISOString(),
    actor: "local-demo-operator",
    capability: `inspect_${pageId}`,
    resource_scope: "local-fixture",
    decision,
  };
}

function stateForError(code: LoadError["code"]): LoadState {
  if (code === "PERMISSION_DENIED") return "permission-denied";
  if (code === "TIMEOUT") return "timeout";
  return "error";
}

export const usePagesStore = defineStore("pages", {
  state: (): PageState => ({
    pageId: null,
    scenario: "success",
    state: "idle",
    response: null,
    error: null,
    audit: null,
    receipt: null,
    requestSerial: 0,
  }),
  getters: {
    page: (store) => store.response?.data ?? null,
    activeAudit: (store): AuditEvent | null =>
      store.audit ?? store.response?.audit ?? null,
  },
  actions: {
    async load(pageId: string, scenario: LocalScenario) {
      const requestSerial = ++this.requestSerial;
      this.pageId = pageId;
      this.scenario = scenario;
      this.state = "loading";
      this.response = null;
      this.error = null;
      this.audit = null;
      this.receipt = null;

      try {
        const response = await runInspectMockPage({ pageId, scenario });
        if (requestSerial !== this.requestSerial) return;
        this.response = response;
        this.audit = response.audit;
        this.state =
          response.status === "warning"
            ? "fallback"
            : response.data?.records.length === 0 &&
                response.data.metrics.length === 0
              ? "empty"
              : "success";
      } catch (error) {
        if (requestSerial !== this.requestSerial) return;
        const normalized =
          error instanceof LocalApiError
            ? { code: error.code, message: error.message }
            : {
                code: "PROVIDER_ERROR" as const,
                message: "本地 fixture 发生未知错误。",
              };
        this.error = normalized;
        this.response =
          error instanceof LocalApiError
            ? ((error.response as PageResponse | undefined) ?? null)
            : null;
        this.audit =
          this.response?.audit ??
          fallbackAudit(
            pageId,
            scenario,
            normalized.code === "PERMISSION_DENIED"
              ? "denied"
              : normalized.code === "TIMEOUT"
                ? "timeout"
                : "error",
          );
        this.state = stateForError(normalized.code);
      }
    },
    runDryRun(actionId: string, role: DemoRole) {
      if (!this.pageId) return;
      this.receipt = runLocalDryRun({
        pageId: this.pageId,
        actionId,
        scenario: this.scenario,
        role,
      });
      this.audit = this.receipt.audit;
    },
  },
});
