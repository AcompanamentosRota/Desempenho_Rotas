"""
saida.py — Serialização estável e gravação atômica dos JSONs.

  - JSON compacto (separators sem espaço): ~25% menor que o arquivo antigo.
  - Mesma entrada => mesmos bytes (a ordem das chaves é montada de forma determinística),
    então o GitHub Actions só faz commit quando o dado mudou de verdade.
  - Grava em arquivo temporário e troca de uma vez (os.replace): o site nunca
    serve um JSON pela metade.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def serializar(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def gravar(caminho: Path, obj: dict) -> bool:
    """Grava `obj` em `caminho` se o conteúdo mudou. Devolve True quando gravou."""
    dados = serializar(obj)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if caminho.exists() and caminho.read_bytes() == dados:
        return False
    temporario = caminho.with_suffix(caminho.suffix + ".tmp")
    temporario.write_bytes(dados)
    os.replace(temporario, caminho)
    return True


def ler(caminho: Path) -> dict | None:
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
