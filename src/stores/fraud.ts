import { defineStore } from "pinia";
import { LocalApiError } from "../adapters/local-api";
import { runInspectFraudOverview } from "../agent-control/capabilities";
import {
  type AuditEvent,
  type FraudLoadState,
  type FraudResponse,
  type FraudScenario,
} from "../core/fraud/contracts";

interface LoadError {
  code: "PERMISSION_DENIED" | "PROVIDER_ERROR" | "TIMEOUT" | "INVALID_DATA";
  message: string;
}

interface FraudState {
  scenario: FraudScenario;
  state: FraudLoadState;
  response: FraudResponse | null;
  error: LoadError | null;
  audit: AuditEvent | null;
  requestSerial: number;
}

function fallbackAudit(
  scenario: FraudScenario,
  decision: AuditEvent["decision"],
): AuditEvent {
  return {
    event_id: `audit-${scenario}-local`,
    timestamp: new Date().toISOString(),
    actor: "local-user",
    capability: "inspect_fraud_overview",
    resource_scope: "local-fixture",
    decision,
  };
}

function stateForError(code: LoadError["code"]): FraudLoadState {
  if (code === "PERMISSION_DENIED") return "permission-denied";
  if (code === "TIMEOUT") return "timeout";
  return "error";
}

export const useFraudStore = defineStore("fraud", {
  state: (): FraudState => ({
    scenario: "success",
    state: "idle",
    response: null,
    error: null,
    audit: null,
    requestSerial: 0,
  }),
  getters: {
    activeAudit: (store): AuditEvent | null =>
      store.response?.audit ?? store.audit,
    overview: (store) => store.response?.data ?? null,
  },
  actions: {
    async load(scenario?: FraudScenario) {
      const requestedScenario = scenario ?? this.scenario;
      const requestSerial = ++this.requestSerial;
      this.scenario = requestedScenario;
      this.state = "loading";
      this.response = null;
      this.error = null;
      this.audit = null;

      try {
        const response = await runInspectFraudOverview({
          scenario: requestedScenario,
        });
        if (requestSerial !== this.requestSerial) return;
        this.response = response;
        this.audit = response.audit;
        this.state =
          response.status === "warning"
            ? "fallback"
            : response.data?.signals.length === 0
              ? "empty"
              : "success";
      } catch (error) {
        if (requestSerial !== this.requestSerial) return;
        const normalized =
          error instanceof LocalApiError
            ? { code: error.code, message: error.message }
            : {
                code: "PROVIDER_ERROR" as const,
                message: "The local fixture failed unexpectedly.",
              };
        this.error = normalized;
        const response = error instanceof LocalApiError ? error.response : null;
        // The request schema is selected by fetchFraudOverview, but the
        // shared transport error also supports page responses. Keep the
        // store's fraud-specific contract narrow at this boundary.
        this.response =
          response && "signals" in (response.data ?? {})
            ? (response as FraudResponse)
            : null;
        this.audit =
          this.response?.audit ??
          fallbackAudit(
            requestedScenario,
            normalized.code === "PERMISSION_DENIED"
              ? "denied"
              : normalized.code === "TIMEOUT"
                ? "timeout"
                : "error",
          );
        this.state = stateForError(normalized.code);
      }
    },
  },
});
