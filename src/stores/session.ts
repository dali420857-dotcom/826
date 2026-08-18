import { computed } from "vue";
import { defineStore } from "pinia";
import {
  demoRoles,
  roleCanAccess,
  useDemoSessionStore,
  type DemoRole,
} from "./demo-session";

/**
 * Compatibility facade for the page shell. The deterministic demo-session
 * store is canonical; this facade keeps the legacy `active_role` shape used
 * by existing page templates while preserving one local role source.
 */
export const useSessionStore = defineStore("session", () => {
  const demo = useDemoSessionStore();
  const active_role = computed<DemoRole>({
    get: () => demo.role,
    set: (nextRole) => demo.setRole(nextRole),
  });

  const operator_id = computed(() => "local-demo-operator" as const);
  const roles = demoRoles;
  const source = "local-fixture" as const;
  const token_storage = "disabled" as const;

  function setRole(nextRole: DemoRole) {
    demo.setRole(nextRole);
  }

  return {
    active_role,
    operator_id,
    roles,
    source,
    token_storage,
    setRole,
  };
});

export { roleCanAccess };
export type { DemoRole };
