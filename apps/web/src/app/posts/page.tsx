'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, apiGet, apiPost } from '../../lib/api';

interface Account {
  id: string;
  displayName: string | null;
  status: string;
}

interface MediaAsset {
  id: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

interface PublishRun {
  id: string;
  attemptNo: number;
  status: string;
  errorCode: string | null;
  errorDetail: string | null;
  artifacts: Array<{ step: string; type: string; key: string }>;
  eventsLog: Array<{ at: string; type: string; step?: string; message?: string }>;
  draftRef: unknown;
}

interface PostTarget {
  id: string;
  status: string;
  mode: string;
  failCode: string | null;
  reconcileStatus: string;
  externalPostId: string | null;
  externalUrl: string | null;
  publishedAt: string | null;
  account: Account;
  runs: PublishRun[];
}

interface Post {
  id: string;
  title: string;
  body: string;
  visibility: string;
  state: string;
  createdAt: string;
  media: MediaAsset[];
  targets: PostTarget[];
}

const stateText: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHING: '发布中',
  PUBLISHED: '已发布',
  PARTIAL: '部分成功',
  FAILED: '失败',
};

const targetStatusText: Record<string, string> = {
  PENDING: '排队中',
  LEASED: '已派发',
  RUNNING: '执行中',
  AWAITING_CONFIRM: '草稿已保存，待确认',
  AWAITING_HUMAN: '需要人工',
  SUCCEEDED: '成功',
  FAILED: '失败',
  CANCELLED: '已取消',
};

const runStatusText: Record<string, string> = {
  QUEUED: '排队中',
  LEASED: '已派发',
  RUNNING: '执行中',
  AWAITING_HUMAN: '需要人工',
  SUCCEEDED: '成功',
  FAILED: '失败',
  TIMED_OUT: '超时',
  CANCELLED: '已取消',
};

const mediaUrl = (key: string) => `${API_BASE}/api/storage/file/${encodeURIComponent(key)}`;

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [mode, setMode] = useState<'DRAFT_THEN_CONFIRM' | 'DIRECT'>('DRAFT_THEN_CONFIRM');
  const [accountId, setAccountId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([apiGet<Post[]>('/api/posts'), apiGet<Account[]>('/api/accounts')]);
      setPosts(p);
      const connected = a.filter((x) => x.status === 'CONNECTED');
      setAccounts(connected);
      if (connected.length === 1) setAccountId((prev) => prev || connected[0].id);
    } catch (e) {
      setError(`无法连接 API: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const validate = (): string | null => {
    const len = title.trim().length;
    if (len < 10 || len > 30) return `标题需 10-30 字（当前 ${len} 字）`;
    if (files.length < 2 || files.length > 35) return `图片需 2-35 张（当前 ${files.length} 张）`;
    for (const f of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return `不支持的格式: ${f.name}`;
      if (f.size > 50 * 1024 * 1024) return `图片超过 50MB: ${f.name}`;
    }
    if (!accountId) return '请先连接抖音账号';
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const mediaIds: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append('file', f);
        const res = await fetch(`${API_BASE}/api/media/upload`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`图片上传失败: ${await res.text()}`);
        const asset = (await res.json()) as MediaAsset;
        mediaIds.push(asset.id);
      }
      const post = await apiPost<Post>('/api/posts', {
        title: title.trim(),
        body: body.trim(),
        visibility,
        mode,
        accountId,
        mediaIds,
      });
      setTitle('');
      setBody('');
      setFiles([]);
      setShowForm(false);
      setExpanded(post.id);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDraft = async (targetId: string) => {
    setBusy(true);
    setError('');
    try {
      await apiPost(`/api/targets/${targetId}/confirm`);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const republish = async (postId: string) => {
    setBusy(true);
    setError('');
    try {
      await apiPost(`/api/posts/${postId}/republish`);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>内容发布</h2>
        {error && <p style={{ color: '#f53f3f' }}>{error}</p>}
        {!showForm ? (
          <button className="primary" onClick={() => setShowForm(true)} disabled={accounts.length === 0}>
            新建图文
          </button>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>
              <label className="field-label">标题（10-30 字）</label>
              <input
                className="text-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="请输入标题"
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label className="field-label">正文（话题用 # 开头，发布时自动联想）</label>
              <textarea
                className="text-area"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'正文内容…\n#话题1 #话题2'}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label className="field-label">图片（2-35 张，JPG/PNG/WebP，单张≤50MB）</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {files.map((f, i) => (
                  <div key={i} className="thumb-box">
                    <img className="thumb-img" src={URL.createObjectURL(f)} alt={f.name} />
                    <span className="muted">{Math.round(f.size / 1024)}KB</span>
                  </div>
                ))}
                <button onClick={() => fileInput.current?.click()}>+ 添加图片</button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
              <label>
                <input type="radio" checked={visibility === 'PRIVATE'} onChange={() => setVisibility('PRIVATE')} />
                仅自己可见
              </label>
              <label>
                <input type="radio" checked={visibility === 'PUBLIC'} onChange={() => setVisibility('PUBLIC')} />
                公开
              </label>
              <label>
                <input type="radio" checked={mode === 'DRAFT_THEN_CONFIRM'} onChange={() => setMode('DRAFT_THEN_CONFIRM')} />
                存草稿后确认（推荐）
              </label>
              <label>
                <input type="radio" checked={mode === 'DIRECT'} onChange={() => setMode('DIRECT')} />
                直接发布
              </label>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label className="field-label">发布账号</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">选择账号</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName ?? a.id}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={submit} disabled={busy}>
                {busy ? '提交中…' : '发布'}
              </button>
              <button onClick={() => setShowForm(false)}>取消</button>
            </div>
          </div>
        )}
      </div>

      {posts.length === 0 && !showForm && <p className="muted">还没有内容。</p>}

      {posts.map((p) => (
        <div key={p.id} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
            <div>
              <b>{p.title}</b>
              <span className="muted" style={{ marginLeft: 12 }}>
                {stateText[p.state]} · {new Date(p.createdAt).toLocaleString()} · {p.visibility === 'PRIVATE' ? '仅自己可见' : '公开'}
              </span>
            </div>
            <span>{expanded === p.id ? '收起 ▲' : '展开 ▼'}</span>
          </div>
          {expanded === p.id && (
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {p.media.map((m) => (
                  <img key={m.id} className="thumb-img" src={mediaUrl(m.storageKey)} alt="" />
                ))}
              </div>
              {p.targets.map((t) => (
                <div key={t.id} style={{ borderTop: '1px solid #f2f3f5', paddingTop: 12 }}>
                  <p>
                    目标: {t.account.displayName ?? t.accountId} · <b>{targetStatusText[t.status]}</b>
                    {t.reconcileStatus === 'PRESENT' && <span style={{ color: '#00b42a' }}> · 对账命中</span>}
                    {t.externalUrl && (
                      <a href={t.externalUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                        查看作品 ↗
                      </a>
                    )}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    {t.status === 'AWAITING_CONFIRM' && (
                      <button className="primary" onClick={() => confirmDraft(t.id)} disabled={busy}>
                        确认发布
                      </button>
                    )}
                    {t.status === 'FAILED' && (
                      <button onClick={() => republish(p.id)} disabled={busy}>
                        重试
                      </button>
                    )}
                  </div>
                  {t.runs.map((r) => (
                    <div key={r.id} className="run-block">
                      <p className="muted">
                        第 {r.attemptNo} 次 · {runStatusText[r.status]}
                        {r.errorCode && <span style={{ color: '#f53f3f' }}> ({r.errorCode})</span>}
                        {r.errorDetail && ` · ${r.errorDetail}`}
                      </p>
                      {r.artifacts.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                          {r.artifacts.map((a, i) => (
                            <a key={i} href={mediaUrl(a.key)} target="_blank" rel="noreferrer" title={a.step}>
                              <img className="thumb-img" src={mediaUrl(a.key)} alt={a.step} />
                            </a>
                          ))}
                        </div>
                      )}
                      {r.eventsLog.length > 0 && (
                        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                          {r.eventsLog.map((ev, i) => (
                            <li key={i}>
                              [{new Date(ev.at).toLocaleTimeString()}] {ev.type}
                              {ev.step ? ` ${ev.step}` : ''} {ev.message ?? ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
