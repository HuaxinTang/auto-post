import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { prisma } from '@auto-post/db';
import { generateToken, hashToken } from '@auto-post/crypto';
import type { Server, Socket } from 'socket.io';
import type { TaskEnvelope, TaskEvent } from '@auto-post/contracts';

const HEARTBEAT_TIMEOUT_MS = 60_000;
const SWEEP_INTERVAL_MS = 15_000;
const ACCEPT_TIMEOUT_MS = 10_000;

export interface ExecutorOnline {
  executorId: string;
  socket: Socket;
  version: string;
  capabilities: string[];
  inflight: string[];
  busy: boolean;
}

@Injectable()
export class ExecutorsService {
  private readonly logger = new Logger(ExecutorsService.name);
  readonly taskEvents = new EventEmitter();

  private online = new Map<string, ExecutorOnline>();
  private io: Server | null = null;
  private acceptTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  setIo(io: Server) {
    this.io = io;
  }

  async enroll(input: {
    enrollCode: string;
    name: string;
    os: string;
    version: string;
    capabilities: string[];
  }) {
    const expected = process.env.DEV_ENROLL_CODE ?? 'dev-enroll-code';
    if (input.enrollCode !== expected) {
      throw new Error('enroll code invalid');
    }
    const token = generateToken();
    const executor = await prisma.executor.create({
      data: {
        organizationId: await this.defaultOrgId(),
        name: input.name,
        os: input.os,
        version: input.version,
        capabilities: input.capabilities,
        tokenHash: hashToken(token),
      },
    });
    return {
      executorId: executor.id,
      token,
      heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    };
  }

  async list() {
    const orgId = await this.defaultOrgId();
    return prisma.executor.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async revoke(executorId: string) {
    await prisma.executor.delete({ where: { id: executorId } });
    const e = this.online.get(executorId);
    if (e) e.socket.disconnect(true);
    this.online.delete(executorId);
  }

  private async defaultOrgId(): Promise<string> {
    const org = await prisma.organization.findFirst();
    if (!org) throw new Error('no organization found');
    return org.id;
  }

  // ---------- WS lifecycle ----------

  async authenticate(token: string): Promise<string | null> {
    const hash = hashToken(token);
    const executor = await prisma.executor.findFirst({ where: { tokenHash: hash } });
    return executor?.id ?? null;
  }

  async handleHello(executorId: string, socket: Socket, payload: {
    agentVersion: string;
    capabilities: string[];
    inflight: string[];
  }) {
    const orgId = await this.defaultOrgId();
    await prisma.executor.update({
      where: { id: executorId },
      data: {
        status: 'ONLINE',
        version: payload.agentVersion,
        capabilities: payload.capabilities,
        lastHeartbeatAt: new Date(),
        organizationId: orgId,
      },
    });
    this.online.set(executorId, {
      executorId,
      socket,
      version: payload.agentVersion,
      capabilities: payload.capabilities,
      inflight: payload.inflight,
      busy: payload.inflight.length > 0,
    });
    this.logger.log(`executor ${executorId} online (${payload.agentVersion})`);
  }

  async handleHeartbeat(executorId: string, load: { busy: boolean; queueDepth: number }) {
    const e = this.online.get(executorId);
    if (e) {
      e.busy = load.busy;
      await prisma.executor.update({
        where: { id: executorId },
        data: { lastHeartbeatAt: new Date(), status: 'ONLINE' },
      });
    }
  }

  handleTaskEvent(executorId: string, taskId: string, seq: number, event: TaskEvent) {
    if (event.type === 'accepted') {
      const timer = this.acceptTimers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        this.acceptTimers.delete(taskId);
      }
    }
    this.taskEvents.emit(`task:${taskId}`, { executorId, seq, event });
  }

  handleDisconnect(executorId: string) {
    this.online.delete(executorId);
    prisma.executor
      .update({ where: { id: executorId }, data: { status: 'OFFLINE' } })
      .catch(() => undefined);
    this.logger.warn(`executor ${executorId} disconnected`);
  }

  private async sweep() {
    const now = Date.now();
    for (const executor of await prisma.executor.findMany({ where: { status: 'ONLINE' } })) {
      const last = executor.lastHeartbeatAt?.getTime() ?? 0;
      if (now - last > HEARTBEAT_TIMEOUT_MS) {
        await prisma.executor.update({
          where: { id: executor.id },
          data: { status: 'OFFLINE' },
        });
        this.online.delete(executor.id);
        this.logger.warn(`executor ${executor.id} marked OFFLINE (heartbeat timeout)`);
      }
    }
  }

  // ---------- Task dispatch ----------

  dispatch(
    task: TaskEnvelope,
    onTimeout: (taskId: string) => void,
    preferredExecutorId?: string
  ): boolean {
    const executor = this.pickExecutor(task.kind, preferredExecutorId);
    if (!executor) {
      this.logger.warn(`no online executor capable of ${task.kind}`);
      return false;
    }
    executor.socket.emit('task.assigned', { v: 1, type: 'task.assigned', task });
    const timer = setTimeout(() => {
      this.acceptTimers.delete(task.taskId);
      this.logger.warn(`task ${task.taskId} not accepted in time`);
      onTimeout(task.taskId);
    }, ACCEPT_TIMEOUT_MS);
    this.acceptTimers.set(task.taskId, timer);
    return true;
  }

  cancel(taskId: string) {
    for (const e of this.online.values()) {
      if (e.inflight.includes(taskId)) {
        e.socket.emit('task.cancel', { v: 1, type: 'task.cancel', taskId });
      }
    }
  }

  private pickExecutor(kind: string, preferredExecutorId?: string): ExecutorOnline | null {
    if (preferredExecutorId) {
      const preferred = this.online.get(preferredExecutorId);
      if (preferred && !preferred.busy && preferred.capabilities.includes(kind)) {
        return preferred;
      }
    }
    for (const e of this.online.values()) {
      if (!e.busy && e.capabilities.includes(kind)) return e;
    }
    for (const e of this.online.values()) {
      if (e.capabilities.includes(kind)) return e;
    }
    return null;
  }
}
