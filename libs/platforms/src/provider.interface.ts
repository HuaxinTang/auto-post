import type {
  MediaRef,
  TaskEnvelope,
  TaskEvent,
  TaskKind,
  TaskResult,
  WorkItem,
} from '@auto-post/contracts';

export type ProviderName = 'DOUYIN' | 'XIAOHONGSHU' | 'WECHAT_MP' | 'WEIBO';
export type AuthMode = 'BROWSER' | 'OFFICIAL_API';
export type PostKind = 'IMAGE_TEXT' | 'VIDEO';
export type Visibility = 'PUBLIC' | 'PRIVATE';

export interface MediaConstraint {
  min: number;
  max: number;
  mimeTypes: string[];
  maxSizeMB: number;
  animated: boolean;
  recommendedAspect: string[];
}

export interface PlatformSpec {
  provider: ProviderName;
  displayName: string;
  authModes: AuthMode[];
  capabilities: {
    kinds: PostKind[];
    supportsDraft: boolean;
    visibility: Visibility[];
    topics: boolean;
  };
  constraints: {
    title: { min: number; max: number };
    body: { min: number; max?: number };
    media: MediaConstraint;
  };
  tasks: {
    login: TaskKind;
    sessionCheck: TaskKind;
    publish: TaskKind;
    confirmDraft?: TaskKind;
    listWorks: TaskKind;
  };
}

export interface PostDraft {
  kind: PostKind;
  title: string;
  body: string;
  visibility: Visibility;
  media: Array<{ mimeType: string; sizeBytes: number }>;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface PlatformAccountLite {
  id: string;
  provider: string;
  externalId: string | null;
  displayName: string | null;
}

export interface PostTargetLite {
  id: string;
  scheduledAt: Date | null;
  externalPostId: string | null;
}

export interface LoginContext {
  taskId: string;
  organizationId: string;
  accountId?: string;
  profileKey: string;
  attempt: number;
  credentialTicket?: string;
}

export interface LoginProgress {
  status: 'QR_READY' | 'SCANNED' | 'AWAITING_HUMAN' | 'CONFIRMED' | 'EXPIRED' | 'FAILED';
  qrImageKey?: string;
  expiresAt?: Date;
  hint?: string;
  errorCode?: string;
}

export interface RemoteWork {
  id: string;
  title: string;
  publishTime: Date;
  status?: string;
  url?: string;
}

export interface TargetOutcome {
  status: 'SUCCEEDED' | 'FAILED' | 'AWAITING_CONFIRM';
  externalPostId?: string;
  externalUrl?: string;
  matchedWork?: WorkItem;
  errorCode?: string;
  draftRef?: Record<string, unknown>;
}

export interface SocialProvider {
  readonly spec: PlatformSpec;
  readonly authMode: AuthMode;

  validateContent(draft: PostDraft): ValidationIssue[];
  startLogin(ctx: LoginContext): TaskEnvelope;
  interpretLoginEvent(ev: TaskEvent): LoginProgress | null;
  buildSessionCheck(account: PlatformAccountLite, taskId: string, attempt: number): TaskEnvelope;
  compilePublish(opts: {
    taskId: string;
    attempt: number;
    account: PlatformAccountLite;
    post: PostDraft;
    target: PostTargetLite;
    mode: 'draft' | 'publish';
    credentialTicket: string;
    media: MediaRef[];
  }): TaskEnvelope;
  compileConfirmDraft(opts: {
    taskId: string;
    attempt: number;
    account: PlatformAccountLite;
    credentialTicket: string;
    draftRef?: Record<string, unknown>;
  }): TaskEnvelope;
  compileListWorks(opts: {
    taskId: string;
    attempt: number;
    account: PlatformAccountLite;
    credentialTicket: string;
    since?: Date;
  }): TaskEnvelope;
  matchWork(works: RemoteWork[], title: string, publishedWindowMin?: number, extraText?: string): RemoteWork | null;
  applyPublishResult(result: TaskResult, mode: 'draft' | 'publish'): TargetOutcome;
}

export interface ProviderRegistry {
  get(provider: ProviderName, authMode: AuthMode): SocialProvider;
  list(): SocialProvider[];
}
