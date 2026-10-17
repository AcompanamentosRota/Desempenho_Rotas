"""
gerar.py — Busca os dados no SAP Datasphere e grava payload.json + online.json.

Uso (na pasta backend/):
    python scripts/gerar.py                     # gera os dois em ../frontend/data
    python scripts/gerar.py --so-online         # só online.json (mais rápido)
    python scripts/gerar.py --rota 111 --forcar # testa uma rota, grava em saida/rota_111/
    python scripts/gerar.py --hoje 2026-11-03 --saida saida/sim --forcar   # simula a data (teste, o cron não usa)
    python scripts/gerar.py --fechamento "Setembro/26"   # só sobrepõe o rótulo da tag de fechamento

Fechamento do mês: detectado sozinho (do dia 1 até o fim do 1º dia útil e, depois, enquanto alguma
gerência não tiver META_VOLUME e META_COBERTURA do mês). Nesse período o payload mostra o mês anterior
e o online.json leva fechamentoMes; com --so-online o rótulo sai do payload já publicado.

Fora da janela de execução (padrão 07:00-18:59, horário de Brasília) termina sem fazer nada,
a não ser com --forcar. Códigos de saída: 0 ok / nada a fazer, 1 erro de execução,
2 dados reprovados na validação (nada é gravado).
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time as relogio
from datetime import datetime, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gerador import calendario, fontes, saida, validacao  # noqa: E402
from gerador.consulta import Consulta  # noqa: E402
from gerador.online import montar_online  # noqa: E402
from gerador.payload import montar_payload, online_ks_tt  # noqa: E402
from odata.config import PASTA_SAIDA, carregar_config  # noqa: E402
from odata.log import configurar_log  # noqa: E402


def _janela(texto: str) -> tuple[time, time]:
    ini, fim = texto.split("-")
    return time.fromisoformat(ini.strip()), time.fromisoformat(fim.strip())


def _github_output(**valores: str) -> None:
    destino = os.getenv("GITHUB_OUTPUT")
    if destino:
        with open(destino, "a", encoding="utf-8") as f:
            for k, v in valores.items():
                f.write(f"{k}={v}\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--saida", type=Path, help="pasta de destino (padrão: SAIDA_DIR ou ../frontend/data)")
    ap.add_argument("--so-online", action="store_true", help="gera só o online.json")
    ap.add_argument("--rota", help="restringe a uma rota (teste); grava em saida/rota_<ROTA>/")
    ap.add_argument("--hoje", help="simula a data (AAAA-MM-DD): teste do fechamento ou --replay; o cron não usa")
    ap.add_argument("--fechamento", help='sobrepõe o rótulo da tag de fechamento, ex.: "Setembro/26" '
                                         '(o período de fechamento é detectado sozinho)')
    ap.add_argument("--forcar", action="store_true", help="ignora a janela de horário")
    ap.add_argument("--gravar-cache", type=Path, help="salva as respostas do Datasphere nesta pasta")
    ap.add_argument("--replay", type=Path, help="usa respostas salvas (sem rede)")
    args = ap.parse_args()

    log = configurar_log("gerar")
    inicio = relogio.monotonic()
    agora = calendario.agora()
    if args.hoje:
        agora = datetime.combine(datetime.fromisoformat(args.hoje).date(), agora.time())

    ini, fim = _janela(os.getenv("JANELA_EXECUCAO", "07:00-18:59"))
    if not args.forcar and not (ini <= agora.time() <= fim):
        log.info("Fora da janela %s-%s (agora %s). Nada a fazer.", ini, fim, agora.time())
        _github_output(mudou="false")
        return 0

    cfg = carregar_config()
    destino = args.saida or (PASTA_SAIDA / f"rota_{args.rota}" if args.rota else cfg.pasta_dados)
    cons = Consulta(cfg, pasta_cache=args.replay or args.gravar_cache,
                    gravar=bool(args.gravar_cache), replay=bool(args.replay))
    log.info("Gerando dados de %s (space %s, modelo %s) -> %s", agora, cfg.space, cfg.objeto, destino)

    from gerador import mapeamento
    mapeamento.OBJ_META = cfg.objeto

    try:
        f = fontes.carregar(cons, agora, rota=args.rota, so_online=args.so_online, fechamento=args.fechamento)
    except Exception as erro:  # noqa: BLE001
        log.error("Falha ao consultar o Datasphere: %s", erro)
        return 1

    payload = None if args.so_online else montar_payload(f)
    # KS TT do online pelo segmento do roster (com --so-online, o do payload já publicado) ou, fora dele, o da venda
    base = payload or saida.ler(destino / "payload.json")
    if args.so_online and not f.online.fechamento_mes:
        f.online.fechamento_mes = fontes.fechamento_pelo_payload(base, agora.date())
    arquivos: dict[str, dict] = {"online.json": montar_online(online_ks_tt(f.online, base, f.segmento_venda))}
    erros, avisos = validacao.validar_online(arquivos["online.json"])
    if payload is not None:
        arquivos["payload.json"] = payload
        anterior = None if args.rota else saida.ler(destino / "payload.json")
        e2, a2 = validacao.validar_payload(arquivos["payload.json"], anterior)
        erros, avisos = erros + e2, avisos + a2
    for a in avisos:
        log.warning("Aviso: %s", a)
    if erros:
        for e in erros:
            log.error("Reprovado: %s", e)
        log.error("Nada foi gravado; o site continua com a versão anterior.")
        _github_output(mudou="false")
        return 2

    mudou = [nome for nome, obj in arquivos.items() if saida.gravar(destino / nome, obj)]
    log.info("Arquivos atualizados: %s (%.0f s no total)", ", ".join(mudou) or "nenhum (dados iguais)",
             relogio.monotonic() - inicio)
    print("CHANGED=" + ",".join(mudou))
    _github_output(mudou="true" if mudou else "false", arquivos=" ".join(mudou))
    return 0


if __name__ == "__main__":
    sys.exit(main())
