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

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import trilha_envio  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def enviar(url, id_cliente, segredo, demanda, payload):
    corpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/api/trilha/{demanda}",
        data=corpo,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "CF-Access-Client-Id": id_cliente,
            "CF-Access-Client-Secret": segredo,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        texto = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(texto)
        except ValueError:
            return e.code, {"erro": texto[:200]}


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

    trilha = trilha_envio.carregar_trilha(a.agencia)
    chaves = os.environ.get("TRILHA_CHAVES_DIR") or None
    demandas = [a.demanda] if a.demanda else trilha_envio.listar_demandas(a.raiz)
    if not demandas:
        sys.exit("Nenhuma trilha encontrada.")

    codigo = 0
    for d in demandas:
        try:
            payload = trilha_envio.montar(trilha, a.raiz, d, chaves)
        except trilha_envio.Adulterada as e:
            print(f"{d}: NÃO ENVIADA, ADULTERADA ({e})")
            codigo = 3
            continue
        except (FileNotFoundError, ValueError) as e:
            print(f"{d}: NÃO ENVIADA ({e})")
            codigo = codigo or 2
            continue
        n = len(payload["linhas"])
        if a.dry_run:
            print(f"{d}: {n} linhas, estado {payload['estado']['status']!r}, {payload['verificacao']} (não enviada: --dry-run)")
            continue
        status, resposta = enviar(url, id_cliente, segredo, d, payload)
        if status == 200:
            print(f"{d}: ok, {resposta.get('aceitas')} novas, {resposta.get('ignoradas')} já conhecidas")
        else:
            print(f"{d}: RECUSADA ({status}): {resposta.get('erro') or resposta}")
            codigo = codigo or 1
    return codigo


if __name__ == "__main__":
    sys.exit(main())
