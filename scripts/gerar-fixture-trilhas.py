#!/usr/bin/env python3
"""Gera o arquivo de teste do app com as trilhas de simulação, usando o MESMO código que o envio de verdade usa.
Uso: python scripts/gerar-fixture-trilhas.py --agencia PASTA_DA_AGENCIA --raiz PASTA_COM_operacao/trilhas --saida test/fixtures/trilhas-reais.json
Só lê as trilhas e o trilha.py; escreve apenas o arquivo de saída."""
import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import trilha_envio  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
p = argparse.ArgumentParser()
p.add_argument("--agencia", required=True)
p.add_argument("--raiz", required=True)
p.add_argument("--saida", required=True)
a = p.parse_args()

trilha = trilha_envio.carregar_trilha(a.agencia)
saida = {d: trilha_envio.montar(trilha, a.raiz, d) for d in trilha_envio.listar_demandas(a.raiz)}
destino = pathlib.Path(a.saida)
destino.parent.mkdir(parents=True, exist_ok=True)
destino.write_text(json.dumps(saida, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
print(f"{len(saida)} demandas, {sum(len(v['linhas']) for v in saida.values())} linhas → {destino}")
