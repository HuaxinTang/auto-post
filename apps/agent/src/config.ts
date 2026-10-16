import { hostname } from 'node:os';

export const config = {
  apiUrl: (process.env.AGENT_API_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  enrollCode: process.env.AGENT_ENROLL_CODE ?? 'dev-enroll-code',
  name: process.env.AGENT_NAME ?? hostname(),
  headless: process.env.AGENT_HEADLESS === 'true',
  profileDir: process.env.AGENT_PROFILE_DIR ?? './.profiles',
  version: process.env.AGENT_VERSION ?? '0.0.1',
  heartbeatIntervalMs: 15_000,
};
