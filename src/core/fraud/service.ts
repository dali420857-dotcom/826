import type { FraudResponse, FraudScenario } from "./contracts";
import { fetchFraudOverview } from "../../adapters/local-api";

export interface InspectFraudOverviewInput {
  scenario: FraudScenario;
}

/**
 * Core service boundary for the read-only fraud overview capability.
 * Transport details stay in the adapter; policy metadata stays in the response envelope.
 */
export async function inspectFraudOverview(
  input: InspectFraudOverviewInput,
): Promise<FraudResponse> {
  return fetchFraudOverview(input.scenario);
}
