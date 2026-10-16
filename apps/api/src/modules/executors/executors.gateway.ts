import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ExecutorsService } from './executors.service';

interface HelloPayload {
  v: 1;
  type: 'hello';
  token: string;
  agentVersion: string;
  capabilities: string[];
  inflight: string[];
}

interface HeartbeatPayload {
  v: 1;
  type: 'heartbeat';
  load: { busy: boolean; queueDepth: number };
}

interface TaskEventPayload {
  v: 1;
  type: 'task.event';
  taskId: string;
  seq: number;
  event: {
    type: string;
    [key: string]: unknown;
  };
}

@WebSocketGateway({
  path: '/executor/ws',
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class ExecutorsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ExecutorsGateway.name);
  @WebSocketServer() server!: Server;

  constructor(private readonly executors: ExecutorsService) {}

  afterInit() {
    this.executors.setIo(this.server);
  }

  async handleConnection(client: Socket) {
    this.logger.log(`ws client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const executorId = (client.data as { executorId?: string }).executorId;
    if (executorId) {
      this.executors.handleDisconnect(executorId);
    }
  }

  @SubscribeMessage('hello')
  async onHello(@ConnectedSocket() client: Socket, @MessageBody() payload: HelloPayload) {
    try {
      const executorId = await this.executors.authenticate(payload.token);
      if (!executorId) {
        client.emit('auth-failed', { message: 'auth failed' });
        client.disconnect(true);
        return;
      }
      (client.data as { executorId: string }).executorId = executorId;
      await this.executors.handleHello(executorId, client, {
        agentVersion: payload.agentVersion,
        capabilities: payload.capabilities,
        inflight: payload.inflight,
      });
    } catch (e) {
      this.logger.error(`hello failed: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('heartbeat')
  async onHeartbeat(@ConnectedSocket() client: Socket, @MessageBody() payload: HeartbeatPayload) {
    const executorId = (client.data as { executorId?: string }).executorId;
    if (executorId) {
      await this.executors.handleHeartbeat(executorId, payload.load);
    }
  }

  @SubscribeMessage('task.event')
  onTaskEvent(@ConnectedSocket() client: Socket, @MessageBody() payload: TaskEventPayload) {
    const executorId = (client.data as { executorId?: string }).executorId;
    if (executorId) {
      this.executors.handleTaskEvent(executorId, payload.taskId, payload.seq, payload.event as never);
    }
  }
}
