import { io, type Socket } from 'socket.io-client';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskEnvelope } from '@auto-post/contracts';
import { config } from './config';
import { enroll } from './api-client';
import { cancelRun, runTask } from './task-runner';
import { closeAll } from './browser/launcher';

interface StoredCredential {
  executorId: string;
  token: string;
}

function loadCredential(): StoredCredential | null {
  const file = join(config.profileDir, 'executor-credential.json');
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as StoredCredential;
  } catch {
    return null;
  }
}

function saveCredential(cred: StoredCredential) {
  mkdirSync(config.profileDir, { recursive: true });
  writeFileSync(join(config.profileDir, 'executor-credential.json'), JSON.stringify(cred, null, 2));
}

async function enrollWithRetry(attempts = 30, delayMs = 10_000): Promise<StoredCredential> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const { executorId, token } = await enroll();
      return { executorId, token };
    } catch (e) {
      console.warn(`[agent] enroll 失败（第 ${i}/${attempts} 次）: ${(e as Error).message}，${delayMs / 1000}s 后重试`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('enroll 重试耗尽');
}

async function main() {
  mkdirSync(config.profileDir, { recursive: true });
  let credential = loadCredential();
  if (credential) {
    console.log(`[agent] 复用已注册身份: executorId=${credential.executorId}`);
  } else {
    console.log(`[agent] enrolling at ${config.apiUrl} as "${config.name}"`);
    credential = await enrollWithRetry();
    saveCredential(credential);
    console.log(`[agent] enrolled: executorId=${credential.executorId}`);
  }

  let socket: Socket | null = null;
  let inflight: string[] = [];
  let busy = false;

  const connect = () => {
    socket = io(config.apiUrl, {
      path: '/executor/ws',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 15_000,
    });

    socket.on('connect', () => {
      console.log('[agent] ws connected');
      socket!.emit('hello', {
        v: 1,
        type: 'hello',
        token: credential!.token,
        agentVersion: config.version,
        capabilities: [
          'browser.screenshot',
          'douyin.login.qr',
          'douyin.session.check',
          'douyin.publish.image',
          'douyin.publish.confirm',
          'douyin.list.works',
        ],
        inflight,
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[agent] ws disconnected: ${reason}`);
    });

    socket.on('auth-failed', async () => {
      console.warn('[agent] token 失效，重新注册');
      socket!.disconnect();
      credential = await enrollWithRetry(3, 5_000);
      saveCredential(credential);
      connect();
    });

    socket.on('task.assigned', async (msg: { task: TaskEnvelope }) => {
      const task = msg.task;
      if (busy) {
        console.warn(`[agent] busy, ignoring task ${task.taskId}`);
        return;
      }
      busy = true;
      inflight.push(task.taskId);
      console.log(`[agent] task assigned: ${task.taskId} (${task.kind})`);
      await runTask(task, credential!.token, (event) => {
        socket?.emit('task.event', { v: 1, type: 'task.event', taskId: task.taskId, seq: 0, event });
      });
      inflight = inflight.filter((t) => t !== task.taskId);
      busy = false;
    });

    socket.on('task.cancel', (msg: { taskId: string }) => {
      cancelRun(msg.taskId);
    });
  };

  connect();

  const heartbeat = setInterval(() => {
    if (socket?.connected) {
      socket.emit('heartbeat', { v: 1, type: 'heartbeat', load: { busy, queueDepth: 0 } });
    }
  }, config.heartbeatIntervalMs);

  const shutdown = async () => {
    clearInterval(heartbeat);
    socket?.disconnect();
    await closeAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[agent] fatal:', e);
  process.exit(1);
});
