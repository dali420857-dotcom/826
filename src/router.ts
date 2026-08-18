import { createRouter, createWebHashHistory } from "vue-router";
import { ROUTE_REGISTRY as routeRegistry } from "./shared/route-registry";

type ViewLoader = () => Promise<unknown>;

const routeViewLoaders: Record<string, ViewLoader> = {
  "/login": () => import("./views/identity/LoginView.vue"),
  "/index": () => import("./views/identity/IndexView.vue"),
  "/preventing_fraud": () => import("./views/FraudPreventionView.vue"),
  "/user_info": () => import("./views/identity/UserInfoView.vue"),
  "/reset_password": () => import("./views/identity/ResetPasswordView.vue"),
  "/account_tatistics": () =>
    import("./views/identity/AccountTatisticsView.vue"),
  "/intelligence": () => import("./views/identity/IntelligenceView.vue"),
  "/proxy_manager": () => import("./views/operations/ProxyManagerView.vue"),
  "/source_manager": () => import("./views/operations/SourceManagerView.vue"),
  "/device_manager": () => import("./views/operations/DeviceManagerView.vue"),
  "/ip_manager": () => import("./views/operations/IpManagerView.vue"),
  "/service_manager": () => import("./views/operations/ServiceManagerView.vue"),
  "/task_manager": () => import("./views/tasks/TasksPageView.vue"),
  "/group_send_msg": () => import("./views/tasks/TasksPageView.vue"),
  "/pull_group": () => import("./views/tasks/TasksPageView.vue"),
  "/screen_data": () => import("./views/tasks/TasksPageView.vue"),
  "/position": () => import("./views/tasks/TasksPageView.vue"),
  "/group_adv": () => import("./views/tasks/TasksPageView.vue"),
  "/build_group": () => import("./views/tasks/TasksPageView.vue"),
  "/collect": () => import("./views/tasks/TasksPageView.vue"),
  "/position_collect": () => import("./views/tasks/TasksPageView.vue"),
  "/work_order": () => import("./views/tasks/TasksPageView.vue"),
};

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      component: () => import("./views/PortalView.vue"),
      meta: { label: "系统选择" },
    },
    ...routeRegistry.map((entry) => ({
      path: entry.path,
      name: entry.fixture_key,
      component:
        (entry.path === "/login"
          ? () => import("./views/ProductLoginView.vue")
          : entry.path === "/index"
            ? () => import("./views/ProductHomeView.vue")
            : routeViewLoaders[entry.path]) ??
        (() => import("./views/PageDashboardView.vue")),
      meta: {
        label: entry.label_zh_cn,
        category: entry.category,
        fixtureKey: entry.fixture_key,
        requiredRole: entry.required_role,
        supportsDryRun: entry.supports_dry_run,
      },
    })),
    {
      path: "/:pathMatch(.*)*",
      redirect: "/index",
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
