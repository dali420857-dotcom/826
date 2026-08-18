import { fetchMockPage } from "../../adapters/local-api";
import type { LocalScenario } from "../contracts/local";
import type { PageResponse } from "./contracts";

export interface InspectMockPageInput {
  pageId: string;
  scenario: LocalScenario;
}

export async function inspectMockPage(
  input: InspectMockPageInput,
): Promise<PageResponse> {
  return fetchMockPage(input.pageId, input.scenario);
}
