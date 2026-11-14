import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';

export const issuer = 'https://equipe-teste.cloudflareaccess.com';
export const audience = 'aud-teste';

// Cria um par de chaves só para o teste e devolve um conjunto de chaves públicas (jwks)
// e uma função que assina tokens parecidos com os do Access.
export async function cenarioToken() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const assinar = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.issuer ?? issuer)
      .setAudience(opts.audience ?? audience)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '1h')
      .sign(privateKey);
  return { jwks, assinar };
}
