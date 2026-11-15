"""Monta o que o app recebe de uma demanda: as linhas exatas da trilha, o estado calculado pelo trilha.py
e o resultado da verificação. Só lê: não altera o trilha.py nem as trilhas."""
import importlib.util
import json
import pathlib
import sys

sys.dont_write_bytecode = True  # não deixar __pycache__ dentro de ferramentas/


class Adulterada(Exception):
    """A verificação do trilha.py falhou: a demanda não deve ser enviada."""


def carregar_trilha(agencia):
    caminho = pathlib.Path(agencia) / "ferramentas" / "trilha" / "trilha.py"
    if not caminho.is_file():
        raise FileNotFoundError(f"trilha.py não encontrado em {caminho}")
    spec = importlib.util.spec_from_file_location("trilha_da_agencia", caminho)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def listar_demandas(raiz):
    pasta = pathlib.Path(raiz) / "operacao" / "trilhas"
    return sorted(p.stem for p in pasta.glob("D-*.jsonl"))


def montar(trilha, raiz, demanda, chaves=None):
    """Devolve {linhas, estado, verificacao} ou levanta Adulterada."""
    ok, mensagem = trilha.verificar(raiz, demanda, chaves)
    if not ok:
        raise Adulterada(mensagem)
    arquivo = trilha.caminho_trilha(raiz, demanda)
    # Mesma leitura do trilha.ler(): o texto de cada linha é o que foi usado no hash da seguinte.
    linhas = [l for l in arquivo.read_text(encoding="utf-8").splitlines() if l.strip()]
    estado = trilha.reconstruir([json.loads(l) for l in linhas], demanda)
    return {"linhas": linhas, "estado": estado, "verificacao": "ÍNTEGRO: " + mensagem}
