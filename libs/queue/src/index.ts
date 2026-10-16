import { Queue, type ConnectionOptions } from 'bullmq';

export const QUEUE_NAMES = {
  publishSchedule: 'publish.schedule',
  reconcile: 'reconcile',
  accountHealth: 'account.health',
  watchdog: 'watchdog',
  notify: 'notify',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const globalQueues = new Map<string, Queue>();

function connection(): ConnectionOptions {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

export function getQueue(name: QueueName): Queue {
  let q = globalQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: connection() });
    globalQueues.set(name, q);
  }
  return q;
}

export type PublishScheduleJobData = {
  targetId: string;
};

export type ReconcileJobData = {
  targetId: string;
  round: number;
};

export type AccountHealthJobData = {
  accountId: string;
};

export type NotifyJobData = {
  channel: 'email' | 'webhook';
  to?: string;
  subject?: string;
  payload: Record<string, unknown>;
};
