import { jwtVerify, createRemoteJWKSet } from 'jose';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usuario } from './db/schema.js';

// Confere o token que o Cloudflare Access coloca em cada pedido:
// assinatura (chaves públicas da equipe), equipe (issuer) e aplicativo (aud).
export async function verificarTokenAccess(token, { jwks, issuer, audience }) {
  const { payload } = await jwtVerify(token, jwks, { issuer, audience });
  return { email: payload.email ?? null, commonName: payload.common_name ?? null };
}

let jwksRemoto;

// `jwks` só é informado nos testes; em produção vem do endereço da equipe.
export function exigirAcesso({ jwks } = {}) {
  return async (c, next) => {
    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) return c.json({ erro: 'sem credencial' }, 401);

    const equipe = c.env.ACCESS_EQUIPE;
    let chaves = jwks;
    if (!chaves) {
      jwksRemoto ??= createRemoteJWKSet(new URL(`${equipe}/cdn-cgi/access/certs`));
      chaves = jwksRemoto;
    }

    let identidade;
    try {
      identidade = await verificarTokenAccess(token, { jwks: chaves, issuer: equipe, audience: c.env.ACCESS_AUD });
    } catch {
      return c.json({ erro: 'credencial inválida' }, 401);
    }
    if (!identidade.email) return c.json({ erro: 'rota não permitida para esta credencial' }, 403);

    const [u] = await drizzle(c.env.DB).select().from(usuario).where(eq(usuario.email, identidade.email));
    if (!u) return c.json({ erro: 'usuário não autorizado' }, 403);

    c.set('usuario', u);
    await next();
  };
}
