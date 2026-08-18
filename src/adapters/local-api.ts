import {
  FraudResponseSchema,
  type FraudResponse,
  type FraudScenario,
} from "../core/fraud/contracts";
import {
  LocalScenarioSchema,
  type LocalScenario,
} from "../core/contracts/local";
import { PageResponseSchema, type PageResponse } from "../core/mock/contracts";

type AnyLocalResponse = FraudResponse | PageResponse;
type JsonSchema<T> = {
  safeParse: (
    value: unknown,
  ) => { success: true; data: T } | { success: false };
};

const requestTimeoutMs = 750;

export class LocalApiError extends Error {
  constructor(
    public readonly code:
      "PERMISSION_DENIED" | "PROVIDER_ERROR" | "TIMEOUT" | "INVALID_DATA",
    message: string,
    public readonly response?: AnyLocalResponse,
  ) {
    super(message);
    this.name = "LocalApiError";
  }
}

export async function fetchFraudOverview(
  scenario: FraudScenario,
): Promise<FraudResponse> {
  return requestLocalJson(
    `/api/preventing-fraud/overview?scenario=${scenario}`,
    FraudResponseSchema,
  );
}

export async function fetchMockPage(
  pageId: string,
  scenario: LocalScenario,
): Promise<PageResponse> {
  const safeScenario = LocalScenarioSchema.parse(scenario);
  const encodedPageId = encodeURIComponent(pageId);
  return requestLocalJson(
    `/api/mock/pages/${encodedPageId}?pageId=${encodedPageId}&scenario=${safeScenario}`,
    PageResponseSchema,
  );
}

async function requestLocalJson<T extends AnyLocalResponse>(
  url: string,
  schema: JsonSchema<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const raw: unknown = await response.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new LocalApiError(
        "INVALID_DATA",
        "The local fixture returned an invalid response.",
      );
    }

    if (!response.ok || parsed.data.status === "error") {
      const detail = parsed.data.error;
      const code =
        detail?.code === "SAFE_STOP"
          ? "PROVIDER_ERROR"
          : (detail?.code ?? "PROVIDER_ERROR");
      const safeMessages: Record<LocalApiError["code"], string> = {
        PERMISSION_DENIED:
          "Observation scope is not approved for this session.",
        PROVIDER_ERROR:
          "The local fixture reported an error and stopped safely.",
        TIMEOUT: "The local fixture did not respond within the safe timeout.",
        INVALID_DATA: "The local fixture returned an invalid response.",
      };
      throw new LocalApiError(code, safeMessages[code], parsed.data);
    }

    return parsed.data;
  } catch (error) {
    if (error instanceof LocalApiError) {
      throw error;
    }
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new LocalApiError(
        "TIMEOUT",
        "The local fixture did not respond within the safe timeout.",
      );
    }
    throw new LocalApiError(
      "PROVIDER_ERROR",
      "The local fixture could not be reached safely.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
