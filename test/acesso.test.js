import { it, expect } from 'vitest';
import { verificarTokenAccess } from '../worker/acesso.js';
import { cenarioToken, issuer, audience } from './ajuda-token.js';

it('aceita token válido e devolve o e-mail', async () => {
  const { jwks, assinar } = await cenarioToken();
  const t = await assinar({ email: 'teste-a@exemplo.com' });
  expect(await verificarTokenAccess(t, { jwks, issuer, audience })).toEqual({
    email: 'teste-a@exemplo.com',
    commonName: null,
  });
});

it('recusa token de outro aplicativo (aud)', async () => {
  const { jwks, assinar } = await cenarioToken();
  const t = await assinar({ email: 'teste-a@exemplo.com' }, { audience: 'outro' });
  await expect(verificarTokenAccess(t, { jwks, issuer, audience })).rejects.toThrow();
});

it('recusa token de outra equipe (issuer)', async () => {
  const { jwks, assinar } = await cenarioToken();
  const t = await assinar({ email: 'teste-a@exemplo.com' }, { issuer: 'https://outra.cloudflareaccess.com' });
  await expect(verificarTokenAccess(t, { jwks, issuer, audience })).rejects.toThrow();
});

it('recusa token expirado', async () => {
  const { jwks, assinar } = await cenarioToken();
  const t = await assinar({ email: 'teste-a@exemplo.com' }, { exp: Math.floor(Date.now() / 1000) - 60 });
  await expect(verificarTokenAccess(t, { jwks, issuer, audience })).rejects.toThrow();
});

it('recusa token assinado por outra chave', async () => {
  const a = await cenarioToken();
  const b = await cenarioToken();
  const t = await b.assinar({ email: 'teste-a@exemplo.com' });
  await expect(verificarTokenAccess(t, { jwks: a.jwks, issuer, audience })).rejects.toThrow();
});
