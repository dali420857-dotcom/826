import type { DemoRole } from "../stores/demo-session";

export const routeCategories = [
  "identity",
  "risk",
  "operations",
  "tasks",
] as const;
export type RouteCategory = (typeof routeCategories)[number];

export interface RouteRegistryEntry {
  path: string;
  label_zh_cn: string;
  description_zh_cn: string;
  category: RouteCategory;
  required_role: DemoRole;
  fixture_key: string;
  supports_dry_run: boolean;
}

const readOnly = "本地演示数据只读，不连接远程服务。";
const dryRun = "操作仅提供本地 dry-run 预览，不会写入外部系统。";

/**
 * Canonical metadata for every publicly observed SPA path. Domain workers use
 * this registry for labels, fixture keys, permissions and navigation rather
 * than maintaining a second route list.
 */
export const ROUTE_REGISTRY = [
  {
    path: "/login",
    label_zh_cn: "登录",
    description_zh_cn: "登录功能暂不接入；当前只提供本地演示会话。",
    category: "identity",
    required_role: "viewer",
    fixture_key: "login",
    supports_dry_run: false,
  },
  {
    path: "/index",
    label_zh_cn: "工作台概览",
    description_zh_cn: readOnly,
    category: "identity",
    required_role: "viewer",
    fixture_key: "index",
    supports_dry_run: false,
  },
  {
    path: "/preventing_fraud",
    label_zh_cn: "风险防护",
    description_zh_cn: readOnly,
    category: "risk",
    required_role: "viewer",
    fixture_key: "preventing-fraud",
    supports_dry_run: false,
  },
  {
    path: "/proxy_manager",
    label_zh_cn: "代理管理",
    description_zh_cn: dryRun,
    category: "operations",
    required_role: "operator",
    fixture_key: "proxy-manager",
    supports_dry_run: true,
  },
  {
    path: "/user_info",
    label_zh_cn: "用户资料",
    description_zh_cn: readOnly,
    category: "identity",
    required_role: "viewer",
    fixture_key: "user-info",
    supports_dry_run: false,
  },
  {
    path: "/reset_password",
    label_zh_cn: "重置密码",
    description_zh_cn: "密码服务暂不接入；不会收集或保存真实密码。",
    category: "identity",
    required_role: "viewer",
    fixture_key: "reset-password",
    supports_dry_run: true,
  },
  {
    path: "/source_manager",
    label_zh_cn: "来源管理",
    description_zh_cn: dryRun,
    category: "operations",
    required_role: "operator",
    fixture_key: "source-manager",
    supports_dry_run: true,
  },
  {
    path: "/device_manager",
    label_zh_cn: "设备管理",
    description_zh_cn: dryRun,
    category: "operations",
    required_role: "operator",
    fixture_key: "device-manager",
    supports_dry_run: true,
  },
  {
    path: "/ip_manager",
    label_zh_cn: "IP 管理",
    description_zh_cn: dryRun,
    category: "operations",
    required_role: "operator",
    fixture_key: "ip-manager",
    supports_dry_run: true,
  },
  {
    path: "/task_manager",
    label_zh_cn: "任务管理",
    description_zh_cn: dryRun,
    category: "tasks",
    required_role: "operator",
    fixture_key: "task-manager",
    supports_dry_run: true,
  },
  {
    path: "/group_send_msg",
    label_zh_cn: "群发消息",
    description_zh_cn: "只展示本地预览，不发送消息或接触 Telegram 账号。",
    category: "tasks",
    required_role: "operator",
    fixture_key: "group-send-msg",
    supports_dry_run: true,
  },
  {
    path: "/pull_group",
    label_zh_cn: "拉取群组",
    description_zh_cn: dryRun,
    category: "tasks",
    required_role: "operator",
    fixture_key: "pull-group",
    supports_dry_run: true,
  },
  {
    path: "/screen_data",
    label_zh_cn: "筛选数据",
    description_zh_cn: readOnly,
    category: "tasks",
    required_role: "viewer",
    fixture_key: "screen-data",
    supports_dry_run: false,
  },
  {
    path: "/service_manager",
    label_zh_cn: "服务管理",
    description_zh_cn: dryRun,
    category: "operations",
    required_role: "operator",
    fixture_key: "service-manager",
    supports_dry_run: true,
  },
  {
    path: "/position",
    label_zh_cn: "位置管理",
    description_zh_cn: dryRun,
    category: "tasks",
    required_role: "operator",
    fixture_key: "position",
    supports_dry_run: true,
  },
  {
    path: "/account_tatistics",
    label_zh_cn: "账户统计",
    description_zh_cn: readOnly,
    category: "identity",
    required_role: "viewer",
    fixture_key: "account-statistics",
    supports_dry_run: false,
  },
  {
    path: "/intelligence",
    label_zh_cn: "情报中心",
    description_zh_cn: readOnly,
    category: "risk",
    required_role: "viewer",
    fixture_key: "intelligence",
    supports_dry_run: false,
  },
  {
    path: "/group_adv",
    label_zh_cn: "群组推广",
    description_zh_cn: dryRun,
    category: "tasks",
    required_role: "operator",
    fixture_key: "group-adv",
    supports_dry_run: true,
  },
  {
    path: "/build_group",
    label_zh_cn: "创建群组",
    description_zh_cn: "只提供本地构建预览，不创建真实群组。",
    category: "tasks",
    required_role: "operator",
    fixture_key: "build-group",
    supports_dry_run: true,
  },
  {
    path: "/collect",
    label_zh_cn: "数据采集",
    description_zh_cn: dryRun,
    category: "tasks",
    required_role: "operator",
    fixture_key: "collect",
    supports_dry_run: true,
  },
  {
    path: "/position_collect",
    label_zh_cn: "位置采集",
    description_zh_cn: dryRun,
    category: "tasks",
    required_role: "operator",
    fixture_key: "position-collect",
    supports_dry_run: true,
  },
  {
    path: "/work_order",
    label_zh_cn: "工单管理",
    description_zh_cn: dryRun,
    category: "tasks",
    required_role: "operator",
    fixture_key: "work-order",
    supports_dry_run: true,
  },
] as const satisfies readonly RouteRegistryEntry[];

export type PublicRoutePath = (typeof ROUTE_REGISTRY)[number]["path"];

export function getRouteEntry(path: string): RouteRegistryEntry | undefined {
  return ROUTE_REGISTRY.find((entry) => entry.path === path);
}

export function getRouteEntryByFixture(
  fixtureKey: string,
): RouteRegistryEntry | undefined {
  return ROUTE_REGISTRY.find((entry) => entry.fixture_key === fixtureKey);
}

export function getRoutesByCategory(category: RouteCategory) {
  return ROUTE_REGISTRY.filter((entry) => entry.category === category);
}
