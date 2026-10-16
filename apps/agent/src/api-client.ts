import { config } from './config';

export async function enroll(): Promise<{ executorId: string; token: string }> {
  const res = await fetch(`${config.apiUrl}/api/executors/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollCode: config.enrollCode,
      name: config.name,
      os: process.platform,
      version: config.version,
      capabilities: [
        'browser.screenshot',
        'douyin.login.qr',
        'douyin.session.check',
        'douyin.publish.image',
        'douyin.publish.confirm',
        'douyin.list.works',
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`enroll failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { executorId: string; token: string };
}

export async function uploadArtifact(key: string, filePath: string, token: string): Promise<string> {
  const form = new FormData();
  const { readFileSync } = await import('node:fs');
  const { basename } = await import('node:path');
  const buf = readFileSync(filePath);
  form.append('file', new Blob([buf]), basename(filePath));
  const res = await fetch(`${config.apiUrl}/api/storage/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`artifact upload failed: ${res.status}`);
  }
  const data = (await res.json()) as { key: string };
  return data.key;
}

export async function fetchCredential(ticket: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${config.apiUrl}/api/credentials/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  if (!res.ok) {
    throw new Error(`credential exchange failed: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}
