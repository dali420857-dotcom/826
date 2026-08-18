import { z } from "zod";

/**
 * Typed, local-only presentation fixtures for the operations surfaces.
 *
 * These records intentionally describe a representative demo workspace rather
 * than a provider response. The MSW page envelope remains the transport
 * boundary; the domain view uses this metadata to keep each resource surface
 * meaningful while the backend is deferred.
 */
export const operationsResourceKinds = [
  "proxy",
  "source",
  "device",
  "ip",
  "service",
] as const;

export const operationsRecordStatuses = [
  "ready",
  "review",
  "paused",
  "degraded",
  "healthy",
  "stopped",
] as const;

export const OperationsResourceKindSchema = z.enum(operationsResourceKinds);
export type OperationsResourceKind = z.infer<
  typeof OperationsResourceKindSchema
>;

export const OperationsRecordStatusSchema = z.enum(operationsRecordStatuses);
export type OperationsRecordStatus = z.infer<
  typeof OperationsRecordStatusSchema
>;

export interface OperationsRecord {
  id: string;
  name: string;
  detail: string;
  status: OperationsRecordStatus;
  status_label_zh_cn: string;
  owner: "operator" | "reviewer";
  updated_at: string;
  metadata: Readonly<Record<string, string>>;
}

export interface OperationsFixture {
  page_id: `${OperationsResourceKind}-manager`;
  kind: OperationsResourceKind;
  title_zh_cn: string;
  eyebrow_zh_cn: string;
  description_zh_cn: string;
  primary_action_zh_cn: string;
  columns_zh_cn: readonly [string, string, string, string];
  filters: readonly string[];
  records: readonly OperationsRecord[];
}

const timestamp = "2026-08-15T18:00:00.000Z";

export const operationsFixtures: Readonly<
  Record<`${OperationsResourceKind}-manager`, OperationsFixture>
> = {
  "proxy-manager": {
    page_id: "proxy-manager",
    kind: "proxy",
    title_zh_cn: "代理管理",
    eyebrow_zh_cn: "代理资源",
    description_zh_cn:
      "查看代理池质量、地域与分配状态；变更只生成本地 dry-run 回执。",
    primary_action_zh_cn: "新增代理预览",
    columns_zh_cn: ["代理节点", "线路与地域", "状态", "更新时间"],
    filters: ["全部线路", "可用", "待复核", "已暂停"],
    records: [
      {
        id: "proxy-001",
        name: "pool-a / edge-01",
        detail: "HTTPS · 新加坡",
        status: "ready",
        status_label_zh_cn: "可用",
        owner: "operator",
        updated_at: timestamp,
        metadata: { latency: "84 ms", success_rate: "98.4%" },
      },
      {
        id: "proxy-002",
        name: "pool-a / edge-02",
        detail: "SOCKS5 · 日本",
        status: "review",
        status_label_zh_cn: "待复核",
        owner: "reviewer",
        updated_at: "2026-08-15T17:42:00.000Z",
        metadata: { latency: "142 ms", success_rate: "92.1%" },
      },
      {
        id: "proxy-003",
        name: "pool-b / edge-07",
        detail: "HTTPS · 美国西部",
        status: "paused",
        status_label_zh_cn: "已暂停",
        owner: "operator",
        updated_at: "2026-08-15T16:12:00.000Z",
        metadata: { latency: "—", success_rate: "—" },
      },
    ],
  },
  "source-manager": {
    page_id: "source-manager",
    kind: "source",
    title_zh_cn: "来源管理",
    eyebrow_zh_cn: "来源目录",
    description_zh_cn:
      "维护来源分组与质量标签；当前只读取本地样本，不抓取受限内容。",
    primary_action_zh_cn: "创建来源分组预览",
    columns_zh_cn: ["来源分组", "类型与范围", "状态", "更新时间"],
    filters: ["全部来源", "已验证", "待复核", "已暂停"],
    records: [
      {
        id: "source-001",
        name: "公开目录 / tech",
        detail: "公开页面 · 只读",
        status: "healthy",
        status_label_zh_cn: "已验证",
        owner: "reviewer",
        updated_at: timestamp,
        metadata: { freshness: "新鲜", scope: "12 个页面" },
      },
      {
        id: "source-002",
        name: "公开目录 / retail",
        detail: "公开页面 · 只读",
        status: "review",
        status_label_zh_cn: "待复核",
        owner: "operator",
        updated_at: "2026-08-15T17:18:00.000Z",
        metadata: { freshness: "陈旧", scope: "4 个页面" },
      },
      {
        id: "source-003",
        name: "本地导入 / sample",
        detail: "本地 fixture · 无外部请求",
        status: "paused",
        status_label_zh_cn: "已暂停",
        owner: "operator",
        updated_at: "2026-08-15T15:30:00.000Z",
        metadata: { freshness: "快照", scope: "3 条记录" },
      },
    ],
  },
  "device-manager": {
    page_id: "device-manager",
    kind: "device",
    title_zh_cn: "设备管理",
    eyebrow_zh_cn: "设备队列",
    description_zh_cn:
      "查看设备健康、绑定和安全停止状态；不会连接真实设备或云手机。",
    primary_action_zh_cn: "绑定设备预览",
    columns_zh_cn: ["设备标识", "平台与区域", "状态", "更新时间"],
    filters: ["全部设备", "在线", "需复核", "已停止"],
    records: [
      {
        id: "device-001",
        name: "demo-device-01",
        detail: "Android 14 · 本地演示",
        status: "healthy",
        status_label_zh_cn: "在线",
        owner: "operator",
        updated_at: timestamp,
        metadata: { battery: "86%", heartbeat: "24 秒前" },
      },
      {
        id: "device-002",
        name: "demo-device-02",
        detail: "Android 13 · 本地演示",
        status: "degraded",
        status_label_zh_cn: "需复核",
        owner: "reviewer",
        updated_at: "2026-08-15T17:36:00.000Z",
        metadata: { battery: "31%", heartbeat: "3 分钟前" },
      },
      {
        id: "device-003",
        name: "demo-device-03",
        detail: "Android 12 · 本地演示",
        status: "stopped",
        status_label_zh_cn: "已停止",
        owner: "operator",
        updated_at: "2026-08-15T16:04:00.000Z",
        metadata: { battery: "—", heartbeat: "已停止" },
      },
    ],
  },
  "ip-manager": {
    page_id: "ip-manager",
    kind: "ip",
    title_zh_cn: "IP 管理",
    eyebrow_zh_cn: "地址池",
    description_zh_cn:
      "展示 IP 池质量与分配状态；不访问外部代理或真实网络资源。",
    primary_action_zh_cn: "分配 IP 预览",
    columns_zh_cn: ["地址池", "地域与类型", "状态", "更新时间"],
    filters: ["全部地址", "可分配", "待复核", "已暂停"],
    records: [
      {
        id: "ip-001",
        name: "198.51.100.24",
        detail: "文档保留地址 · 新加坡",
        status: "ready",
        status_label_zh_cn: "可分配",
        owner: "operator",
        updated_at: timestamp,
        metadata: { pool: "A", usage: "34%" },
      },
      {
        id: "ip-002",
        name: "198.51.100.31",
        detail: "文档保留地址 · 日本",
        status: "review",
        status_label_zh_cn: "待复核",
        owner: "reviewer",
        updated_at: "2026-08-15T17:27:00.000Z",
        metadata: { pool: "A", usage: "88%" },
      },
      {
        id: "ip-003",
        name: "203.0.113.17",
        detail: "文档保留地址 · 美国西部",
        status: "paused",
        status_label_zh_cn: "已暂停",
        owner: "operator",
        updated_at: "2026-08-15T15:55:00.000Z",
        metadata: { pool: "B", usage: "—" },
      },
    ],
  },
  "service-manager": {
    page_id: "service-manager",
    kind: "service",
    title_zh_cn: "服务管理",
    eyebrow_zh_cn: "服务控制",
    description_zh_cn:
      "查看服务开关与限额；本阶段不调用生产服务，操作只生成本地审计。",
    primary_action_zh_cn: "调整服务开关预览",
    columns_zh_cn: ["服务名称", "版本与限额", "状态", "更新时间"],
    filters: ["全部服务", "运行中", "需复核", "已停止"],
    records: [
      {
        id: "service-001",
        name: "local-mock-api",
        detail: "本地接口 · 127.0.0.1",
        status: "healthy",
        status_label_zh_cn: "运行中",
        owner: "operator",
        updated_at: timestamp,
        metadata: { version: "fixture-0.1", rate_limit: "本地" },
      },
      {
        id: "service-002",
        name: "device-readback",
        detail: "设备读回 · 模拟器",
        status: "review",
        status_label_zh_cn: "需复核",
        owner: "reviewer",
        updated_at: "2026-08-15T17:10:00.000Z",
        metadata: { version: "fixture-0.1", rate_limit: "10/min" },
      },
      {
        id: "service-003",
        name: "external-provider",
        detail: "外部服务 · 本阶段关闭",
        status: "stopped",
        status_label_zh_cn: "已停止",
        owner: "operator",
        updated_at: "2026-08-15T14:00:00.000Z",
        metadata: { version: "未接入", rate_limit: "禁止" },
      },
    ],
  },
};

export function getOperationsFixture(
  pageId: string,
): OperationsFixture | undefined {
  return operationsFixtures[pageId as keyof typeof operationsFixtures];
}
