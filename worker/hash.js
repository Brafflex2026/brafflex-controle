// SHA-256 em hexadecimal. Serve para guardar quem pediu para sair sem guardar o telefone nem o Place ID.
export async function sha256(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
