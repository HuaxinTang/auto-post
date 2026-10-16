import { z } from 'zod';

export const TASK_KINDS = [
  'browser.screenshot',
  'douyin.login.qr',
  'douyin.session.check',
  'douyin.publish.image',
  'douyin.publish.confirm',
  'douyin.list.works',
] as const;

export const TaskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const RUN_ERROR_CODES = [
  'LOGIN_EXPIRED',
  'SMS_CHALLENGE',
  'CAPTCHA_CHALLENGE',
  'SELECTOR_MISSING',
  'AUDIT_REJECTED',
  'UPLOAD_FAILED',
  'NETWORK',
  'RATE_LIMITED',
  'ALREADY_PUBLISHED',
  'TIMED_OUT',
  'CANCELLED',
  'UNKNOWN',
] as const;

export const RunErrorCodeSchema = z.enum(RUN_ERROR_CODES);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

export const MediaRefSchema = z.object({
  presignedUrl: z.string(),
  sha256: z.string(),
  filename: z.string(),
  mimeType: z.string(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const DouyinPublishImageParamsSchema = z.object({
  accountId: z.string(),
  profileKey: z.string(),
  credentialTicket: z.string(),
  mode: z.enum(['draft', 'publish']),
  title: z.string(),
  body: z.string(),
  visibility: z.enum(['public', 'self_only']),
  media: z.array(MediaRefSchema),
});
export type DouyinPublishImageParams = z.infer<typeof DouyinPublishImageParamsSchema>;

export const DouyinPublishConfirmParamsSchema = z.object({
  accountId: z.string(),
  profileKey: z.string(),
  credentialTicket: z.string(),
  draftRef: z.record(z.string(), z.unknown()).optional(),
});
export type DouyinPublishConfirmParams = z.infer<typeof DouyinPublishConfirmParamsSchema>;

export const DouyinListWorksParamsSchema = z.object({
  accountId: z.string(),
  profileKey: z.string(),
  credentialTicket: z.string(),
  since: z.string().optional(),
});
export type DouyinListWorksParams = z.infer<typeof DouyinListWorksParamsSchema>;

export const DouyinLoginQrParamsSchema = z.object({
  accountId: z.string().optional(),
  profileKey: z.string(),
});
export type DouyinLoginQrParams = z.infer<typeof DouyinLoginQrParamsSchema>;

export const DouyinSessionCheckParamsSchema = z.object({
  accountId: z.string(),
  profileKey: z.string(),
});
export type DouyinSessionCheckParams = z.infer<typeof DouyinSessionCheckParamsSchema>;

export const BrowserScreenshotParamsSchema = z.object({
  url: z.string().default('https://creator.douyin.com'),
});
export type BrowserScreenshotParams = z.infer<typeof BrowserScreenshotParamsSchema>;

export const TaskEnvelopeSchema = z.object({
  taskId: z.string(),
  kind: TaskKindSchema,
  attempt: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()),
  deadlineAt: z.string(),
  idempotencyKey: z.string(),
});
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;

export const WorkItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  publishTime: z.string(),
  status: z.string().optional(),
  url: z.string().optional(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const TaskResultSchema = z.object({
  ok: z.boolean(),
  draftRef: z.record(z.string(), z.unknown()).optional(),
  workId: z.string().optional(),
  url: z.string().optional(),
  works: z.array(WorkItemSchema).optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  externalId: z.string().optional(),
  credentialState: z.record(z.string(), z.unknown()).optional(),
  screenshots: z.array(z.string()).optional(),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

export const TaskEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted') }),
  z.object({ type: z.literal('progress'), step: z.string(), pct: z.number().optional() }),
  z.object({ type: z.literal('qr'), imageKey: z.string(), expiresAt: z.string() }),
  z.object({ type: z.literal('screenshot'), step: z.string(), imageKey: z.string() }),
  z.object({
    type: z.literal('awaiting_human'),
    reason: z.enum(['sms', 'captcha']),
    hint: z.string().optional(),
    screenshotKey: z.string().optional(),
  }),
  z.object({ type: z.literal('log'), level: z.enum(['info', 'warn', 'error']), message: z.string() }),
  z.object({ type: z.literal('result'), data: TaskResultSchema }),
  z.object({ type: z.literal('failed'), code: RunErrorCodeSchema, message: z.string() }),
]);
export type TaskEvent = z.infer<typeof TaskEventSchema>;

export const ServerToAgentSchema = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('task.assigned'), task: TaskEnvelopeSchema }),
  z.object({ v: z.literal(1), type: z.literal('task.cancel'), taskId: z.string() }),
  z.object({
    v: z.literal(1),
    type: z.literal('human.input'),
    taskId: z.string(),
    field: z.string(),
    value: z.string(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('config.update'),
    selectorsVersion: z.string(),
    payload: z.unknown(),
    signature: z.string(),
  }),
]);
export type ServerToAgent = z.infer<typeof ServerToAgentSchema>;

export const AgentToServerSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(1),
    type: z.literal('hello'),
    token: z.string(),
    agentVersion: z.string(),
    capabilities: z.array(TaskKindSchema),
    inflight: z.array(z.string()),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('heartbeat'),
    load: z.object({ busy: z.boolean(), queueDepth: z.number() }),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('task.event'),
    taskId: z.string(),
    seq: z.number(),
    event: TaskEventSchema,
  }),
]);
export type AgentToServer = z.infer<typeof AgentToServerSchema>;
