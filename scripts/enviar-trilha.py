#!/usr/bin/env python3
"""Envia ao app de controle as trilhas de demanda do PC.

Para cada demanda: roda a verificação do trilha.py (cadeia de hash e, se TRILHA_CHAVES_DIR estiver definido,
as assinaturas), calcula o estado com o próprio trilha.py e envia as linhas exatas, o estado e o resultado.
NÃO altera nada em ferramentas/ nem nas trilhas. Demanda adulterada não é enviada (saída com código 3).

Variáveis de ambiente (o segredo nunca vai em argumento nem aparece na saída):
  APP_URL                    endereço do app, por exemplo https://brafflex-controle.rodrigo-guarinobackup.workers.dev
  CF_ACCESS_CLIENT_ID        Client ID do service token do Cloudflare Access
  CF_ACCESS_CLIENT_SECRET    Client Secret do service token (só no PC)
  TRILHA_CHAVES_DIR          (opcional) pasta com as chaves dos atores, para conferir assinaturas

Uso: python scripts/enviar-trilha.py --agencia PASTA_DA_AGENCIA --raiz PASTA_COM_operacao [--demanda D-101] [--dry-run]
"""
import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

sys.dont_write_bytecode = True  # antes de importar: não deixar __pycache__ nem em scripts/ nem em ferramentas/
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import trilha_envio  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


class SemRedirecionar(urllib.request.HTTPRedirectHandler):
    """Nunca segue redirecionamento: o segredo não pode ser reenviado a outro endereço (por exemplo, a tela de login)."""

    def redirect_request(self, *args, **kwargs):
        return None


def enviar(url, id_cliente, segredo, demanda, payload):
    corpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/api/trilha/{demanda}",
        data=corpo,
        method="POST",
        headers={
            "Content-Type": "application/json",
            # A Cloudflare barra o identificador padrão do urllib (erro 1010); um nome próprio resolve.
            "User-Agent": "brafflex-enviar-trilha/1.0",
            "CF-Access-Client-Id": id_cliente,
            "CF-Access-Client-Secret": segredo,
        },
    )
    abridor = urllib.request.build_opener(SemRedirecionar)
    try:
        with abridor.open(req, timeout=60) as r:
            texto, status = r.read().decode("utf-8", errors="replace"), r.status
    except urllib.error.HTTPError as e:
        texto, status = e.read().decode("utf-8", errors="replace"), e.code
    try:
        dados = json.loads(texto or "{}")
    except ValueError:
        trecho = " ".join(texto.split())[:80]
        return status, {"erro": f"resposta que não é do app (o login do Access ou a Cloudflare barrou o envio): {trecho}"}
    return status, dados if isinstance(dados, dict) else {"erro": "resposta inesperada"}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--agencia", required=True, help="pasta do repositório da agência (onde está ferramentas/trilha/trilha.py)")
    p.add_argument("--raiz", required=True, help="pasta que contém operacao/trilhas (a mesma --raiz do trilha.py)")
    p.add_argument("--demanda", help="enviar só esta demanda (padrão: todas)")
    p.add_argument("--dry-run", action="store_true", help="verifica e mostra o que enviaria, sem enviar")
    a = p.parse_args()

    url = os.environ.get("APP_URL", "")
    id_cliente = os.environ.get("CF_ACCESS_CLIENT_ID", "")
    segredo = os.environ.get("CF_ACCESS_CLIENT_SECRET", "")
    if not a.dry_run and not (url and id_cliente and segredo):
        sys.exit("Faltam APP_URL, CF_ACCESS_CLIENT_ID ou CF_ACCESS_CLIENT_SECRET no ambiente (use --dry-run para só verificar).")
    if url and not (url.startswith("https://") or url.startswith("http://localhost") or url.startswith("http://127.0.0.1")):
        sys.exit("APP_URL precisa começar com https:// (o segredo não deve trafegar sem criptografia).")

    trilha = trilha_envio.carregar_trilha(a.agencia)
    chaves = os.environ.get("TRILHA_CHAVES_DIR") or None
    if not chaves:
        print("AVISO: TRILHA_CHAVES_DIR não está definido; só a cadeia de hash foi conferida, as assinaturas NÃO.")
    demandas = [a.demanda] if a.demanda else trilha_envio.listar_demandas(a.raiz)
    if not demandas:
        sys.exit("Nenhuma trilha encontrada.")

    codigo = 0
    for d in demandas:
        try:
            payload = trilha_envio.montar(trilha, a.raiz, d, chaves)
            n = len(payload["linhas"])
            if a.dry_run:
                print(f"{d}: {n} linhas, estado {payload['estado']['status']!r}, {payload['verificacao']} (não enviada: --dry-run)")
                continue
            status, resposta = enviar(url, id_cliente, segredo, d, payload)
            if status == 409 and "outro envio" in str(resposta.get("erro", "")):
                status, resposta = enviar(url, id_cliente, segredo, d, payload)  # outro envio igual chegou antes: repete uma vez
        except trilha_envio.Adulterada as e:
            print(f"{d}: NÃO ENVIADA, ADULTERADA ({e})")
            codigo = 3
            continue
        except Exception as e:  # um problema numa demanda não pode derrubar as outras
            print(f"{d}: NÃO ENVIADA ({type(e).__name__}: {str(e)[:160]})")
            codigo = codigo or 2
            continue
        if status == 200:
            print(f"{d}: ok, {resposta.get('aceitas')} novas, {resposta.get('ignoradas')} já conhecidas")
        else:
            print(f"{d}: RECUSADA ({status}): {resposta.get('erro') or resposta}")
            codigo = codigo or 1
    return codigo


if __name__ == "__main__":
    sys.exit(main())
