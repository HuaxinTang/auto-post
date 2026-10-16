'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, apiGet, apiPost } from '../../lib/api';

interface Account {
  id: string;
  provider: string;
  displayName: string | null;
  avatarUrl: string | null;
  externalId: string | null;
  status: 'PENDING' | 'CONNECTED' | 'EXPIRED' | 'NEEDS_REAUTH' | 'DISABLED' | 'BANNED';
  executorId: string | null;
  lastHealthOkAt: string | null;
  createdAt: string;
}

interface LoginSession {
  id: string;
  status: 'CREATED' | 'DISPATCHED' | 'QR_READY' | 'SCANNED' | 'AWAITING_HUMAN' | 'CONFIRMED' | 'EXPIRED' | 'FAILED';
  qrImageKey: string | null;
  expiresAt: string | null;
  hint: string | null;
}

interface Executor {
  id: string;
  name: string;
  status: 'ONLINE' | 'OFFLINE' | 'DRAINING';
}

const statusText: Record<Account['status'], string> = {
  PENDING: '待连接',
  CONNECTED: '已连接',
  EXPIRED: '登录已过期',
  NEEDS_REAUTH: '需重新授权',
  DISABLED: '已禁用',
  BANNED: '已封禁',
};

const sessionStep: Record<LoginSession['status'], string> = {
  CREATED: '创建中…',
  DISPATCHED: '等待执行器…',
  QR_READY: '请用抖音 App 扫码',
  SCANNED: '已扫码，请在手机上确认',
  AWAITING_HUMAN: '需要人工验证',
  CONFIRMED: '连接成功',
  EXPIRED: '二维码已过期',
  FAILED: '连接失败',
};

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [executors, setExecutors] = useState<Executor[]>([]);
  const [session, setSession] = useState<LoginSession | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [selectedExecutor, setSelectedExecutor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [accs, exes] = await Promise.all([
        apiGet<Account[]>('/api/accounts'),
        apiGet<Executor[]>('/api/executors'),
      ]);
      setAccounts(accs);
      setExecutors(exes);
      const online = exes.filter((e) => e.status === 'ONLINE');
      if (online.length === 1) setSelectedExecutor((prev) => prev || online[0].id);
    } catch (e) {
      setError(`无法连接 API: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const startPolling = (accId: string, sid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await apiGet<LoginSession>(`/api/accounts/${accId}/login-sessions/${sid}`);
        setSession(s);
        if (['CONFIRMED', 'FAILED', 'EXPIRED'].includes(s.status)) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          refresh();
        }
      } catch {
        /* ignore */
      }
    }, 2000);
  };

  const connect = async (existingAccountId?: string) => {
    setError('');
    setBusy(true);
    try {
      const accId = existingAccountId ?? (await apiPost<Account>('/api/accounts', { provider: 'DOUYIN' })).id;
      setAccountId(accId);
      const s = await apiPost<LoginSession>(`/api/accounts/${accId}/login`, {
        executorId: selectedExecutor || undefined,
      });
      setSession(s);
      startPolling(accId, s.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const checkSession = async (accId: string) => {
    setError('');
    setBusy(true);
    try {
      await apiPost(`/api/accounts/${accId}/check`);
      setTimeout(refresh, 8000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (accId: string) => {
    if (!confirm('确认删除该账号？')) return;
    try {
      await apiDelete(`/api/accounts/${accId}`);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const closeModal = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setSession(null);
    setAccountId(null);
    refresh();
  };

  const onlineExecutors = executors.filter((e) => e.status === 'ONLINE');
  const qrUrl = session?.qrImageKey
    ? `${API_BASE}/api/storage/file/${encodeURIComponent(session.qrImageKey)}`
    : null;

  return (
    <div>
      <div className="card">
        <h2>平台账号</h2>
        {error && <p style={{ color: '#f53f3f' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <button className="primary" onClick={() => connect()} disabled={busy || onlineExecutors.length === 0}>
            连接抖音
          </button>
          {onlineExecutors.length > 1 && (
            <select
              value={selectedExecutor}
              onChange={(e) => setSelectedExecutor(e.target.value)}
              disabled={busy}
            >
              <option value="">自动选择执行器</option>
              {onlineExecutors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          {onlineExecutors.length === 0 && (
            <span className="muted">没有在线执行器，请先在本机启动 agent</span>
          )}
        </div>

        {accounts.length === 0 && <p className="muted">还没有账号，点击「连接抖音」开始。</p>}

        {accounts.map((a) => (
          <div key={a.id} className="account-row">
            <div className="account-info">
              {a.avatarUrl ? <img className="avatar" src={a.avatarUrl} alt="" /> : <div className="avatar placeholder" />}
              <div>
                <div className="account-name">{a.displayName ?? a.externalId ?? '未命名账号'}</div>
                <div className="muted">
                  {statusText[a.status]}
                  {a.lastHealthOkAt && ` · 最后巡检 ${new Date(a.lastHealthOkAt).toLocaleString()}`}
                </div>
              </div>
            </div>
            <div className="account-actions">
              <span className={`badge ${a.status === 'CONNECTED' ? 'online' : 'offline'}`}>
                {statusText[a.status]}
              </span>
              {a.status === 'CONNECTED' && (
                <button onClick={() => checkSession(a.id)} disabled={busy}>
                  检查登录态
                </button>
              )}
              {['EXPIRED', 'NEEDS_REAUTH', 'PENDING'].includes(a.status) && (
                <button onClick={() => connect(a.id)} disabled={busy}>
                  重新连接
                </button>
              )}
              <button onClick={() => removeAccount(a.id)} disabled={busy}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {session && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>连接抖音</h3>
            <p className="muted">{sessionStep[session.status]}</p>
            {qrUrl && session.status === 'QR_READY' && (
              <div>
                <img className="qr" src={qrUrl} alt="抖音登录二维码" />
                {session.expiresAt && (
                  <p className="muted">
                    二维码有效期至 {new Date(session.expiresAt).toLocaleTimeString()}，过期自动刷新
                  </p>
                )}
              </div>
            )}
            {session.status === 'AWAITING_HUMAN' && (
              <p>
                {session.hint ?? '需要人工验证'}——请到运行执行器的电脑上查看浏览器窗口完成验证，
                完成后本页会自动继续。
              </p>
            )}
            {session.status === 'CONFIRMED' && <p style={{ color: '#00b42a' }}>连接成功！</p>}
            {session.status === 'FAILED' && <p style={{ color: '#f53f3f' }}>连接失败：{session.hint ?? '未知原因'}</p>}
            <div style={{ marginTop: 16 }}>
              <button onClick={closeModal}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
