import { computed, ref } from "vue";
import { defineStore } from "pinia";

export const demoRoles = ["operator", "viewer", "reviewer"] as const;
export type DemoRole = (typeof demoRoles)[number];

export interface DemoSession {
  session_id: "local-demo-session";
  actor_id: "demo-operator" | "demo-viewer" | "demo-reviewer";
  actor_label: string;
  role: DemoRole;
  auth_mode: "local-demo";
}

const sessionByRole: Record<DemoRole, DemoSession> = {
  operator: {
    session_id: "local-demo-session",
    actor_id: "demo-operator",
    actor_label: "本地操作员",
    role: "operator",
    auth_mode: "local-demo",
  },
  viewer: {
    session_id: "local-demo-session",
    actor_id: "demo-viewer",
    actor_label: "本地查看者",
    role: "viewer",
    auth_mode: "local-demo",
  },
  reviewer: {
    session_id: "local-demo-session",
    actor_id: "demo-reviewer",
    actor_label: "本地审核员",
    role: "reviewer",
    auth_mode: "local-demo",
  },
};

export const demoRoleLabels: Record<DemoRole, string> = {
  operator: "操作员",
  viewer: "查看者",
  reviewer: "审核员",
};

/**
 * Return a fresh deterministic session object. No token, cookie, or browser
 * storage is read or written by this helper.
 */
export function createDemoSession(role: DemoRole = "operator"): DemoSession {
  return { ...sessionByRole[role] };
}

/**
 * Higher privilege roles can observe lower privilege routes. The role order
 * is intentionally local-only and must not be used as real authorization.
 */
export function roleCanAccess(current: DemoRole, required: DemoRole): boolean {
  const rank: Record<DemoRole, number> = {
    viewer: 1,
    operator: 2,
    reviewer: 3,
  };
  return rank[current] >= rank[required];
}

export const useDemoSessionStore = defineStore("demo-session", () => {
  const role = ref<DemoRole>("operator");
  const session = computed(() => createDemoSession(role.value));

  function setRole(nextRole: DemoRole) {
    role.value = nextRole;
  }

  function reset() {
    role.value = "operator";
  }

  return { role, session, setRole, reset };
});
