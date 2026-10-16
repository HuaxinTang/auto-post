import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ExecutorsService } from '../executors/executors.service';
import type { TaskEnvelope, TaskEvent } from '@auto-post/contracts';

export interface SmokeRun {
  id: string;
  url: string;
  status: 'QUEUED' | 'DISPATCHED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  events: Array<{ at: string; type: string; step?: string; message?: string }>;
  screenshotKey?: string;
  errorCode?: string;
  createdAt: string;
}

@Injectable()
export class SmokeService {
  private readonly logger = new Logger(SmokeService.name);
  private runs = new Map<string, SmokeRun>();

  constructor(private readonly executors: ExecutorsService) {}

  start(url: string): SmokeRun {
    const id = randomUUID();
    const run: SmokeRun = {
      id,
      url,
      status: 'QUEUED',
      events: [],
      createdAt: new Date().toISOString(),
    };
    this.runs.set(id, run);

    const task: TaskEnvelope = {
      taskId: id,
      kind: 'browser.screenshot',
      attempt: 1,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `${id}:1`,
      params: { url },
    };

    const listener = ({ event }: { event: TaskEvent }) => {
      this.applyEvent(run, event);
    };
    this.executors.taskEvents.on(`task:${id}`, listener);

    const dispatched = this.executors.dispatch(task, (taskId) => {
      const r = this.runs.get(taskId);
      if (r && r.status !== 'SUCCEEDED') {
        r.status = 'FAILED';
        r.errorCode = 'NO_EXECUTOR';
        r.events.push({ at: new Date().toISOString(), type: 'failed', message: 'no executor accepted' });
      }
    });

    if (!dispatched) {
      run.status = 'FAILED';
      run.errorCode = 'NO_EXECUTOR';
      run.events.push({ at: new Date().toISOString(), type: 'failed', message: 'no online executor' });
    } else {
      run.status = 'DISPATCHED';
    }
    return run;
  }

  get(id: string): SmokeRun | undefined {
    return this.runs.get(id);
  }

  list(): SmokeRun[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  }

  private applyEvent(run: SmokeRun, event: TaskEvent) {
    switch (event.type) {
      case 'accepted':
        run.status = 'RUNNING';
        run.events.push({ at: new Date().toISOString(), type: 'accepted' });
        break;
      case 'progress':
        run.status = 'RUNNING';
        run.events.push({ at: new Date().toISOString(), type: 'progress', step: event.step });
        break;
      case 'screenshot':
        run.screenshotKey = event.imageKey;
        run.events.push({ at: new Date().toISOString(), type: 'screenshot', step: event.step });
        break;
      case 'result':
        if (event.data.ok) {
          run.status = 'SUCCEEDED';
          run.screenshotKey = run.screenshotKey ?? event.data.screenshots?.[0];
        } else {
          run.status = 'FAILED';
        }
        run.events.push({ at: new Date().toISOString(), type: 'result' });
        break;
      case 'failed':
        run.status = 'FAILED';
        run.errorCode = event.code;
        run.events.push({ at: new Date().toISOString(), type: 'failed', message: event.message });
        break;
      case 'log':
        run.events.push({ at: new Date().toISOString(), type: 'log', message: `[${event.level}] ${event.message}` });
        break;
      default:
        run.events.push({ at: new Date().toISOString(), type: event.type });
    }
  }
}
