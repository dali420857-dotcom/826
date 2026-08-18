import { z } from "zod";

/**
 * Route-specific identity fixtures used by the local presentation layer.
 *
 * These are deliberately provider-neutral samples. They describe the shape
 * of each public identity/risk surface without representing a real user,
 * account, credential, token or remote session.
 */
export const identityFixtureIds = [
  "login",
  "index",
  "user-info",
  "reset-password",
  "account-statistics",
  "intelligence",
] as const;

export type IdentityFixtureId = (typeof identityFixtureIds)[number];

const identityMetricSchema = z.object({
  label_zh_cn: z.string().min(1),
  value: z.string().min(1),
  detail_zh_cn: z.string().min(1),
  tone: z.enum(["teal", "amber", "red", "neutral"]),
});

const identityRecordSchema = z.object({
  id: z.string().min(1),
  title_zh_cn: z.string().min(1),
  detail_zh_cn: z.string().min(1),
  status_zh_cn: z.string().min(1),
  status_tone: z.enum(["teal", "amber", "red", "neutral"]),
});

export const identityFixtureSchema = z.object({
  page_id: z.enum(identityFixtureIds),
  title_zh_cn: z.string().min(1),
  eyebrow_zh_cn: z.string().min(1),
  description_zh_cn: z.string().min(1),
  required_role: z.enum(["operator", "viewer", "reviewer"]),
  supports_dry_run: z.boolean(),
  metrics: z.array(identityMetricSchema),
  records: z.array(identityRecordSchema),
});

export type IdentityFixture = z.infer<typeof identityFixtureSchema>;

function record(
  id: string,
  title_zh_cn: string,
  detail_zh_cn: string,
  status_zh_cn: string,
  status_tone: IdentityFixture["records"][number]["status_tone"],
): IdentityFixture["records"][number] {
  return { id, title_zh_cn, detail_zh_cn, status_zh_cn, status_tone };
}

const readOnly = (page_id: IdentityFixtureId) => ({
  page_id,
  required_role: "viewer" as const,
  supports_dry_run: false,
});

export const identityFixtures: Record<IdentityFixtureId, IdentityFixture> = {
  login: {
    ...readOnly("login"),
    title_zh_cn: "本地演示登录",
    eyebrow_zh_cn: "身份入口",
    description_zh_cn:
      "此入口只切换本地演示角色，不收集真实账号、密码、cookie 或 token。",
    metrics: [
      {
        label_zh_cn: "认证模式",
        value: "Local",
        detail_zh_cn: "本地 fixture",
        tone: "teal",
      },
      {
        label_zh_cn: "凭证存储",
        value: "关闭",
        detail_zh_cn: "不会写入浏览器",
        tone: "neutral",
      },
      {
        label_zh_cn: "外部请求",
        value: "0",
        detail_zh_cn: "安全边界",
        tone: "red",
      },
    ],
    records: [
      record(
        "login-local",
        "local-demo-session",
        "固定演示会话，仅用于查看本地页面",
        "可用",
        "teal",
      ),
    ],
  },
  index: {
    ...readOnly("index"),
    title_zh_cn: "工作台概览",
    eyebrow_zh_cn: "控制台",
    description_zh_cn: "查看风险、任务、设备与工单的本地汇总，不连接生产服务。",
    metrics: [
      {
        label_zh_cn: "待复核",
        value: "12",
        detail_zh_cn: "本地队列",
        tone: "amber",
      },
      {
        label_zh_cn: "运行中",
        value: "08",
        detail_zh_cn: "演示任务",
        tone: "teal",
      },
      {
        label_zh_cn: "安全停止",
        value: "02",
        detail_zh_cn: "等待人工处理",
        tone: "red",
      },
    ],
    records: [
      record("index-risk", "风险观察", "3 条本地信号待复核", "待处理", "amber"),
      record("index-task", "任务队列", "仅显示演示任务状态", "只读", "teal"),
      record(
        "index-order",
        "工单中心",
        "需要授权才可查看变更",
        "安全停止",
        "red",
      ),
    ],
  },
  "user-info": {
    ...readOnly("user-info"),
    title_zh_cn: "用户资料",
    eyebrow_zh_cn: "账户信息",
    description_zh_cn: "显示脱敏的本地演示身份，不保存或读取真实个人资料。",
    metrics: [
      {
        label_zh_cn: "会话来源",
        value: "本地",
        detail_zh_cn: "local-demo",
        tone: "teal",
      },
      {
        label_zh_cn: "角色范围",
        value: "3",
        detail_zh_cn: "可切换演示角色",
        tone: "neutral",
      },
      {
        label_zh_cn: "凭证",
        value: "无",
        detail_zh_cn: "token storage disabled",
        tone: "red",
      },
    ],
    records: [
      record(
        "user-local",
        "local-demo-operator",
        "演示操作者标识",
        "已脱敏",
        "teal",
      ),
      record("user-source", "local-fixture", "资料来源", "只读", "neutral"),
    ],
  },
  "reset-password": {
    page_id: "reset-password",
    required_role: "viewer",
    supports_dry_run: true,
    title_zh_cn: "重置密码",
    eyebrow_zh_cn: "安全设置",
    description_zh_cn:
      "保留确认流程，但不接受真实密码；提交只生成本地 dry-run 审计回执。",
    metrics: [
      {
        label_zh_cn: "真实服务",
        value: "关闭",
        detail_zh_cn: "后端未接入",
        tone: "red",
      },
      {
        label_zh_cn: "确认步骤",
        value: "2",
        detail_zh_cn: "本地模拟",
        tone: "amber",
      },
      {
        label_zh_cn: "写入外部",
        value: "否",
        detail_zh_cn: "mutation_applied: false",
        tone: "teal",
      },
    ],
    records: [
      record(
        "password-safety",
        "安全停止点",
        "确认前不会产生任何请求或真实修改",
        "已锁定",
        "red",
      ),
    ],
  },
  "account-statistics": {
    ...readOnly("account-statistics"),
    title_zh_cn: "账户统计",
    eyebrow_zh_cn: "身份分析",
    description_zh_cn: "以本地样本展示账户活跃度、风险分布与审核趋势。",
    metrics: [
      {
        label_zh_cn: "活跃账户",
        value: "128",
        detail_zh_cn: "本地样本",
        tone: "teal",
      },
      {
        label_zh_cn: "需复核",
        value: "17",
        detail_zh_cn: "风险队列",
        tone: "amber",
      },
      {
        label_zh_cn: "已暂停",
        value: "04",
        detail_zh_cn: "安全停止",
        tone: "red",
      },
    ],
    records: [
      record(
        "stats-active",
        "近 24 小时活跃度",
        "保持在本地基线内",
        "稳定",
        "teal",
      ),
      record("stats-risk", "风险占比", "需要复核的样本", "关注", "amber"),
      record("stats-hold", "暂停样本", "等待授权的动作", "已停止", "red"),
    ],
  },
  intelligence: {
    ...readOnly("intelligence"),
    title_zh_cn: "情报中心",
    eyebrow_zh_cn: "风险与分析",
    description_zh_cn: "整理公开面观察线索与本地分析队列，不导入受限资料。",
    metrics: [
      {
        label_zh_cn: "观察线索",
        value: "24",
        detail_zh_cn: "公开面样本",
        tone: "teal",
      },
      {
        label_zh_cn: "高风险",
        value: "06",
        detail_zh_cn: "需要复核",
        tone: "red",
      },
      {
        label_zh_cn: "待确认",
        value: "11",
        detail_zh_cn: "本地分析队列",
        tone: "amber",
      },
    ],
    records: [
      record(
        "intel-001",
        "异常登录节奏",
        "与本地基线存在偏差",
        "待复核",
        "amber",
      ),
      record("intel-002", "设备指纹聚合", "仅使用脱敏样本", "已观察", "teal"),
      record("intel-003", "代理质量下降", "达到本地安全阈值", "高风险", "red"),
    ],
  },
};

export const identityFixtureSchemaMap = Object.fromEntries(
  identityFixtureIds.map((id) => [id, identityFixtureSchema]),
);
