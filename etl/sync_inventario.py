#!/usr/bin/env python3
"""
sync_inventario.py — orquestrador do sistema MOVIMENTACAO DE INVENTARIO.

Leva, numa tacada so, as rotinas 266 (bloqueio/desbloqueio do estoque) e 1147
(inventario rotativo) do Oracle/WinThor para o Supabase (projeto DATA WAREHOUSE,
schema `inventario`), confere o resultado e deixa pronto o pacote do painel.

Passos:
  1. cada consulta do catalogo (cadastros, posicao de hoje, inventario, bloqueio),
     cada uma isolada: se uma falhar, as outras seguem;
  2. conferencia: os ajustes da 1147 no banco contra os EI/SI que a propria 1147
     lancou no PCMOV (quantidade e valor). Diferenca vira AVISO no controle_carga;
  3. pacote do painel: monta o JSON (inventario.painel_dados()), comprime em gzip e
     guarda em inventario.painel_cache — a API so le essa linha.

O resultado de cada passo fica em inventario.controle_carga: e essa tabela, nao o
log na tela, que responde "a carga entrou?".

Como usar
---------
    python sync_inventario.py                       # tudo
    python sync_inventario.py --consulta bloqueio   # so uma consulta (o pacote e refeito)
    python sync_inventario.py --so-pacote           # so refaz o pacote do painel
    python sync_inventario.py --listar              # mostra o catalogo e sai

Antes da primeira carga, rode o diagnostico_inventario.py: ele testa as consultas
SEM gravar nada e confere a 1147 contra o PCMOV.
"""

from __future__ import annotations

import argparse
import gzip
import sys
from datetime import datetime, timedelta

import bi_comum as bi

log = bi.configurar_log("sync_inventario.log")

# Sem isto o bi_comum gravaria o controle_carga no schema do BI COMPRAS.
bi.definir_schema("inventario")


def _argumentos() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sincroniza MOVIMENTACAO DE INVENTARIO (Oracle/WinThor -> Supabase).")
    p.add_argument("--consulta", nargs="+", metavar="NOME", help="Roda apenas as consultas indicadas.")
    p.add_argument("--so-pacote", action="store_true", help="Nao le o WinThor: so refaz o pacote do painel.")
    p.add_argument("--listar", action="store_true", help="Mostra o catalogo de consultas e sai.")
    return p.parse_args()


def _f(n: int | float | None) -> str:
    return "-" if n is None else f"{n:,.0f}".replace(",", ".")


class _Passo:
    """Um passo que nao e consulta, mas tambem vai para o controle_carga."""

    def __init__(self, nome: str, destino: str):
        self.nome, self.destino, self.linhas_esperadas = nome, destino, None


# ---------------------------------------------------------------------------
# Conferencia: 1147 no banco x EI/SI que a 1147 lancou no PCMOV
# ---------------------------------------------------------------------------
SQL_PCMOV_1147 = """
SELECT M.CODOPER, COUNT(*) AS N, SUM(M.QT) AS QT, SUM(M.QT * M.PUNIT) AS VL
  FROM PCMOV M
 WHERE M.DTMOV >= :de AND M.DTMOV < :ate
   AND M.CODOPER IN ('EI', 'SI')
   AND M.ROTINACAD LIKE '%1147%'
   AND {filial}
 GROUP BY M.CODOPER
"""


def conferir_1147(conn_ora, conn_pg) -> tuple[str, str]:
    """Devolve (status, mensagem). Janela: do 30o dia depois da data inicial ate ontem,
    por data de ATUALIZACAO (e a data do lancamento no PCMOV); assim um inventario
    montado antes da data inicial e atualizado depois nao vira alarme falso."""
    from consultas_inventario import _data_inicial, _in_filial
    de = _data_inicial() + timedelta(days=30)
    ate = datetime.now().date()          # ate ontem (hoje fica de fora: pode estar no meio)
    with conn_ora.cursor() as cur:
        cur.execute(SQL_PCMOV_1147.format(filial=_in_filial("M.CODFILIAL")), {"de": de, "ate": ate})
        ora = {r[0]: (int(r[1]), float(r[2] or 0), float(r[3] or 0)) for r in cur.fetchall()}
    with conn_pg.cursor() as cur:
        cur.execute(
            """SELECT tipoajuste, COUNT(*), COALESCE(SUM(qtdif), 0), COALESCE(SUM(vldif), 0)
                 FROM inventario.fato_inventario
                WHERE tipoajuste IN ('EI', 'SI') AND dt_atualizacao >= %s AND dt_atualizacao < %s
                GROUP BY tipoajuste""", (de, ate))
        pg = {r[0]: (int(r[1]), float(r[2]), float(r[3])) for r in cur.fetchall()}
    conn_pg.rollback()
    partes, ok = [], True
    for op, nome in (("EI", "sobra"), ("SI", "falta")):
        o, p = ora.get(op, (0, 0.0, 0.0)), pg.get(op, (0, 0.0, 0.0))
        bate = o[0] == p[0] and abs(o[1] - p[1]) < 0.01 and abs(o[2] - p[2]) <= 1.0
        ok = ok and bate
        partes.append(f"{nome} ({op}): banco {p[0]} ajustes, {p[1]:.3f} un., R$ {p[2]:.2f} x PCMOV {o[0]}, "
                      f"{o[1]:.3f} un., R$ {o[2]:.2f}" + ("" if bate else " — NAO BATE"))
    msg = f"Janela {de:%d/%m/%Y} a {ate - timedelta(days=1):%d/%m/%Y}. " + "; ".join(partes)
    return ("OK" if ok else "AVISO"), msg


# ---------------------------------------------------------------------------
# Pacote do painel
# ---------------------------------------------------------------------------
def montar_pacote(conn_pg) -> tuple[int, int, str]:
    """Monta o JSON do painel no banco, comprime aqui e guarda em painel_cache."""
    with conn_pg.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = 300000")
        cur.execute("SELECT inventario.painel_dados()::text")
        texto_json = cur.fetchone()[0]
        bruto = texto_json.encode("utf-8")
        comprimido = gzip.compress(bruto, compresslevel=7)
        versao = datetime.now().strftime("%Y%m%d-%H%M%S")
        cur.execute(
            """INSERT INTO inventario.painel_cache (id, gerado_em, versao, bytes_json, bytes_gz, payload_gz)
               VALUES (1, now(), %s, %s, %s, %s)
               ON CONFLICT (id) DO UPDATE SET gerado_em = EXCLUDED.gerado_em, versao = EXCLUDED.versao,
                      bytes_json = EXCLUDED.bytes_json, bytes_gz = EXCLUDED.bytes_gz, payload_gz = EXCLUDED.payload_gz""",
            (versao, len(bruto), len(comprimido), bi.psycopg2.Binary(comprimido)))
    conn_pg.commit()
    return len(bruto), len(comprimido), versao


def _dizer_ate_quando(conn_pg) -> None:
    """Uma linha de verdade no fim: ate quando o painel tem movimento. Quem roda o
    ATUALIZAR AGORA.bat le isto, sem abrir o banco."""
    try:
        with conn_pg.cursor() as cur:
            cur.execute("""SELECT (SELECT MAX(dt) FROM inventario.fato_bloqueio),
                                  (SELECT COUNT(*) FROM inventario.fato_bloqueio),
                                  (SELECT MAX(dt_atualizacao) FROM inventario.fato_inventario),
                                  (SELECT COUNT(DISTINCT numinvent) FROM inventario.fato_inventario)""")
            ult_b, n_b, ult_i, n_i = cur.fetchone()
        conn_pg.rollback()
        log.info("PAINEL ATUALIZADO: movimentos ate %s (%s no banco); ultimo inventario atualizado em %s (%s inventarios).",
                 ult_b.strftime("%d/%m/%Y %H:%M") if ult_b else "?", _f(n_b),
                 ult_i.strftime("%d/%m/%Y %H:%M") if ult_i else "?", _f(n_i))
    except Exception as exc:  # noqa: BLE001
        conn_pg.rollback()
        log.warning("  nao consegui ler ate quando o painel esta atualizado: %s", exc)


def main() -> int:
    args = _argumentos()
    bi.carregar_env()

    from consultas_inventario import catalogo, selecionar  # le o ENV: so depois dele

    if args.listar:
        print()
        print(f"{'CONSULTA':14s} {'DESTINO':30s} DESCRICAO")
        print("-" * 100)
        for c in catalogo():
            print(f"{c.nome:14s} {c.destino:30s} {c.descricao}")
        print()
        return 0

    try:
        cfg_ora = bi.OracleConfig.from_env()
        cfg_pg = bi.SupabaseConfig.from_env()
    except SystemExit as exc:
        log.error("Configuracao invalida: %s", exc)
        return 1

    consultas = [] if args.so_pacote else selecionar(args.consulta)
    if consultas:
        log.info("Vou rodar %d consulta(s): %s", len(consultas), ", ".join(c.nome for c in consultas))
    resultados: list[tuple[str, str, int | None, float]] = []

    try:
        with bi.conectar_oracle(cfg_ora) as conn_ora, bi.conectar_supabase(cfg_pg) as conn_pg, \
             bi.tranca_de_carga(conn_pg, "carga"):
            for consulta in consultas:
                relogio = bi.cronometro()
                log.info("=" * 70)
                log.info("[%s] %s", consulta.nome, consulta.descricao)
                try:
                    if consulta.streaming:
                        linhas = bi.carregar_em_lotes(conn_ora, conn_pg, consulta, tamanho=50000)
                    else:
                        brutas = bi.extrair(conn_ora, consulta)
                        log.info("  Oracle devolveu %s linhas.", _f(len(brutas)))
                        linhas = bi.carregar(conn_pg, consulta, brutas)
                    conn_pg.commit()
                    segundos = relogio()
                    aviso = bi.avaliar_contagem(consulta, linhas)
                    log.info("  OK — %s linhas em %.1fs -> %s", _f(linhas), segundos, consulta.destino)
                    resultados.append((consulta.nome, "OK", linhas, segundos))
                    bi.registrar_execucao(conn_pg, consulta, "OK", linhas, segundos, aviso)
                except Exception as exc:  # noqa: BLE001 — uma falha nao pode derrubar as outras
                    conn_pg.rollback()
                    segundos = relogio()
                    log.exception("  FALHOU: %s", consulta.nome)
                    resultados.append((consulta.nome, "ERRO", None, segundos))
                    bi.registrar_execucao(conn_pg, consulta, "ERRO", None, segundos, f"{type(exc).__name__}: {exc}")

            # --- conferencia da 1147 contra o PCMOV ---------------------------------
            if not args.so_pacote and (not args.consulta or "inventario" in args.consulta):
                relogio = bi.cronometro()
                passo = _Passo("conferencia_1147", "inventario.fato_inventario x PCMOV")
                try:
                    status, msg = conferir_1147(conn_ora, conn_pg)
                    (log.info if status == "OK" else log.warning)("  conferencia 1147 x PCMOV: %s — %s", status, msg)
                except Exception as exc:  # noqa: BLE001
                    conn_pg.rollback()
                    status, msg = "AVISO", f"Nao consegui conferir: {type(exc).__name__}: {exc}"
                    log.warning("  %s", msg)
                bi.registrar_execucao(conn_pg, passo, status, None, relogio(), msg)
                resultados.append((passo.nome, status, None, relogio()))

            # --- pacote do painel ----------------------------------------------------
            relogio = bi.cronometro()
            passo = _Passo("pacote", "inventario.painel_cache")
            try:
                n_json, n_gz, versao = montar_pacote(conn_pg)
                segundos = relogio()
                msg = f"versao {versao}: JSON de {n_json / 1024:.0f} KB, {n_gz / 1024:.0f} KB comprimido"
                log.info("  pacote do painel pronto em %.1fs — %s", segundos, msg)
                bi.registrar_execucao(conn_pg, passo, "OK", None, segundos, msg)
                resultados.append((passo.nome, "OK", None, segundos))
            except Exception as exc:  # noqa: BLE001
                conn_pg.rollback()
                segundos = relogio()
                log.exception("  FALHOU o pacote do painel (a tela segue com o pacote anterior)")
                bi.registrar_execucao(conn_pg, passo, "ERRO", None, segundos, f"{type(exc).__name__}: {exc}")
                resultados.append((passo.nome, "ERRO", None, segundos))

            _dizer_ate_quando(conn_pg)
            log.info("=" * 70)
            log.info("RESUMO DA CARGA")
            log.info("%-18s %-6s %12s %9s", "PASSO", "STATUS", "LINHAS", "TEMPO")
            for nome, status, linhas, segundos in resultados:
                log.info("%-18s %-6s %12s %8.1fs", nome, status, _f(linhas), segundos)
            log.info("=" * 70)

    except bi.CargaJaRodando as aviso:
        # Nao e erro: e a tranca fazendo o trabalho dela. Sair com 0 evita que o
        # Agendador fique reiniciando uma tarefa que esta certa em nao rodar.
        log.warning("%s", aviso)
        return 0
    except Exception:
        log.exception("Nao consegui nem abrir as conexoes — nada foi carregado.")
        return 1

    falhas = [r for r in resultados if r[1] == "ERRO"]
    if falhas:
        log.error("%d passo(s) falharam: %s", len(falhas), ", ".join(r[0] for r in falhas))
        return 1
    log.info("Carga concluida.")
    return 0


if __name__ == "__main__":
    try:
        codigo = main()
    except Exception:
        log.exception("Erro inesperado — veja o traceback acima / no sync_inventario.log.")
        codigo = 1
    sys.exit(codigo)
