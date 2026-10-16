'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, apiGet, apiPost } from '../../lib/api';

interface Executor {
  id: string;
  name: string;
  version: string;
  os: string;
  status: 'ONLINE' | 'OFFLINE' | 'DRAINING';
  lastHeartbeatAt: string | null;
  capabilities: string[];
}

interface SmokeRun {
  id: string;
  url: string;
  status: 'QUEUED' | 'DISPATCHED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  events: Array<{ at: string; type: string; step?: string; message?: string }>;
  screenshotKey?: string;
  errorCode?: string;
  createdAt: string;
}

const statusText: Record<string, string> = {
  QUEUED: '排队中',
  DISPATCHED: '已派发',
  RUNNING: '执行中',
  SUCCEEDED: '成功',
  FAILED: '失败',
};

export default function ExecutorsPage() {
  const [executors, setExecutors] = useState<Executor[]>([]);
  const [smokes, setSmokes] = useState<SmokeRun[]>([]);
  const [active, setActive] = useState<SmokeRun | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshExecutors = useCallback(async () => {
    try {
      setExecutors(await apiGet<Executor[]>('/api/executors'));
    } catch {
      setError('无法连接 API，请确认 API 已启动 (http://localhost:3001)');
    }
  }, []);

  const refreshSmokes = useCallback(async () => {
    try {
      setSmokes(await apiGet<SmokeRun[]>('/api/smoke'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshExecutors();
    refreshSmokes();
    pollRef.current = setInterval(() => {
      refreshExecutors();
      refreshSmokes();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshExecutors, refreshSmokes]);

  const shotUrl = (key: string) =>
    `${API_BASE}/api/storage/file/${encodeURIComponent(key)}`;

  const viewRun = async (id: string) => {
    try {
      setActive(await apiGet<SmokeRun>(`/api/smoke/${id}`));
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (e) {
      setError(`加载记录失败: ${(e as Error).message}`);
    }
  };

  const runSmoke = async () => {
    setError('');
    try {
      const run = await apiPost<SmokeRun>('/api/smoke', {
        url: 'https://creator.douyin.com',
      });
      setActive(run);
      pollRef.current && clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        refreshExecutors();
        refreshSmokes();
        try {
          const latest = await apiGet<SmokeRun>(`/api/smoke/${run.id}`);
          setActive(latest);
          if (['SUCCEEDED', 'FAILED'].includes(latest.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(() => {
              refreshExecutors();
              refreshSmokes();
            }, 3000);
          }
        } catch {
          /* ignore */
        }
      }, 1500);
    } catch (e) {
      setError(`冒烟测试失败: ${(e as Error).message}`);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>执行器</h2>
        {error && <p style={{ color: '#f53f3f' }}>{error}</p>}
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>状态</th>
              <th>版本</th>
              <th>系统</th>
              <th>最后心跳</th>
            </tr>
          </thead>
          <tbody>
            {executors.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  暂无执行器，请在本地运行以下命令注册：
                </td>
              </tr>
            )}
            {executors.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>
                  <span className={`badge ${e.status === 'ONLINE' ? 'online' : 'offline'}`}>
                    {e.status === 'ONLINE' ? '在线' : '离线'}
                  </span>
                </td>
                <td>{e.version}</td>
                <td>{e.os}</td>
                <td className="muted">
                  {e.lastHeartbeatAt ? new Date(e.lastHeartbeatAt).toLocaleTimeString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12 }}>
          <pre className="code-block">{`# 在本机（住宅 IP 机器）注册执行器
cd apps/agent
AGENT_API_URL=${API_BASE} pnpm serve`}</pre>
        </div>
      </div>

      <div className="card">
        <h2>冒烟测试</h2>
        <p className="muted">
          打开 creator.douyin.com 并截图，验证执行器连通性与浏览器反检测配置。
        </p>
        <button className="primary" onClick={runSmoke}>
          运行冒烟测试
        </button>

        {active && (
          <div style={{ marginTop: 16 }}>
            <p>
              状态: <b>{statusText[active.status]}</b>{' '}
              {active.errorCode && <span style={{ color: '#f53f3f' }}>({active.errorCode})</span>}
            </p>
            <ul className="muted">
              {active.events.map((ev, i) => (
                <li key={i}>
                  [{new Date(ev.at).toLocaleTimeString()}] {ev.type}
                  {ev.step ? ` ${ev.step}` : ''} {ev.message ?? ''}
                </li>
              ))}
            </ul>
            {active.screenshotKey && (
              <div>
                <img className="shot" src={shotUrl(active.screenshotKey)} alt="冒烟截图" />
                <p>
                  <a href={shotUrl(active.screenshotKey)} target="_blank" rel="noreferrer">
                    在新标签页打开原图
                  </a>
                </p>
              </div>
            )}
          </div>
        )}

        {smokes.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3>历史记录</h3>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>URL</th>
                  <th>状态</th>
                  <th>截图</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {smokes.slice(0, 10).map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.createdAt).toLocaleString()}</td>
                    <td>{s.url}</td>
                    <td>{statusText[s.status]}</td>
                    <td>
                      {s.screenshotKey ? (
                        <a href={shotUrl(s.screenshotKey)} target="_blank" rel="noreferrer">
                          <img className="thumb" src={shotUrl(s.screenshotKey)} alt="截图" />
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button onClick={() => viewRun(s.id)}>查看</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
