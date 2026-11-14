import { SELF } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('GET /api/saude responde ok', async () => {
  const r = await SELF.fetch('https://app.test/api/saude');
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
});
