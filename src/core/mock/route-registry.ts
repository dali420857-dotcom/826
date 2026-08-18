import { ROUTE_REGISTRY } from "../../shared/route-registry";
import type { RouteRegistryEntry } from "./contracts";

type PageType = RouteRegistryEntry["page_type"];

function pageTypeFor(
  path: string,
  category: RouteRegistryEntry["category"],
): PageType {
  if (
    path === "/login" ||
    path === "/reset_password" ||
    path === "/user_info"
  ) {
    return "form";
  }
  if (category === "operations" || path === "/screen_data") return "table";
  if (category === "tasks") return "workflow";
  return "dashboard";
}

/**
 * Compatibility view for older page modules. The shared registry is the
 * canonical source of route metadata; this adapter only adds page-template
 * information needed by the generic dashboard.
 */
export const routeRegistry: readonly RouteRegistryEntry[] = ROUTE_REGISTRY.map(
  (entry) => ({
    ...entry,
    page_type: pageTypeFor(entry.path, entry.category),
  }),
);

export const routeRegistryByPath = new Map<string, RouteRegistryEntry>(
  routeRegistry.map((entry) => [entry.path, entry]),
);

export const routeRegistryByFixture = new Map<string, RouteRegistryEntry>(
  routeRegistry.map((entry) => [entry.fixture_key, entry]),
);
