#!/usr/bin/env python3
"""
diagnostico_inventario.py — roda TODAS as consultas do MOVIMENTACAO DE INVENTARIO
contra o WinThor SEM GRAVAR NADA, mede o tempo e confere o que da para conferir:

  1. quantas linhas cada consulta traz;
  2. 1147: a diferenca de cada produto (EI/SI do log) contra os EI/SI que a 1147
     lancou no PCMOV, mes a mes (quantidade e valor);
  3. 1147: produto contado em mais de um local no mesmo inventario (o painel soma
     por inventario + filial + produto; se aparecer, a regra precisa mudar);
  4. 266: quantos movimentos de cada programa (para ver se surgiu programa novo,
     que a view vw_bloqueio ainda nao sabe ler).

Uso:  python diagnostico_inventario.py
Resultado na tela e em diagnostico_inventario.log.
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict

import bi_comum as bi

log = bi.configurar_log("diagnostico_inventario.log")

PROGRAMAS_CONHECIDOS = ("PCSIS266", "[PCSIS266", "WMS DA KAIZEN", "1303", "1346", "1361", "1316", "552", "1122")


def _f(n) -> str:
    return f"{n:,.0f}".replace(",", ".")


def main() -> int:
    bi.carregar_env()
    from consultas_inventario import catalogo, filiais, _data_inicial, _in_filial

    cfg_ora = bi.OracleConfig.from_env()
    log.info("Filiais: %s · desde %s", filiais(), _data_inicial())
    problemas = 0
    with bi.conectar_oracle(cfg_ora) as conn:
        dados = {}
        for c in catalogo():
            rel = bi.cronometro()
            if c.streaming:
                n, prog = 0, Counter()
                for lote in bi._lotes(conn, c, 50000):
                    n += len(lote)
                    for r in lote:
                        prog[r["programa"] or "-"] += 1
                dados[c.nome] = prog
                log.info("%-12s %10s linhas  %6.1fs", c.nome, _f(n), rel())
            else:
                linhas = bi.extrair(conn, c)
                for r in linhas[:3]:
                    c.mapear(r)            # o mapeamento roda sem erro?
                dados[c.nome] = linhas
                log.info("%-12s %10s linhas  %6.1fs", c.nome, _f(len(linhas)), rel())

        # --- 266: programas -------------------------------------------------------
        log.info("=" * 70)
        log.info("266 — movimentos por programa:")
        for p, n in dados["bloqueio"].most_common():
            conhecido = any(k in p for k in PROGRAMAS_CONHECIDOS)
            log.info("   %-34s %9s%s", p, _f(n), "" if conhecido else "   <-- PROGRAMA NOVO: a view vw_bloqueio nao o classifica")
            problemas += 0 if conhecido else 1

        # --- 1147: locais ----------------------------------------------------------
        inv = dados["inventario"]
        chaves = Counter((r["numinvent"], r["codfilial"], r["codprod"]) for r in inv)
        repetidos = sum(1 for v in chaves.values() if v > 1)
        log.info("=" * 70)
        log.info("1147 — %s produtos contados em %s inventarios; %s produto(s) em mais de um local no mesmo inventario%s",
                 _f(len(inv)), _f(len({r['numinvent'] for r in inv})), repetidos, " <-- REVER A REGRA" if repetidos else "")
        problemas += 1 if repetidos else 0

        # --- 1147 x PCMOV, mes a mes -----------------------------------------------
        banco = defaultdict(lambda: [0, 0.0, 0.0])
        for r in inv:
            if r["tipoajuste"] in ("EI", "SI") and r["dtatualizacao"]:
                k = (r["dtatualizacao"].strftime("%Y-%m"), r["tipoajuste"])
                banco[k][0] += 1
                banco[k][1] += float(r["qtdif"] or 0)
                banco[k][2] += float(r["vldif"] or 0)
        sql = f"""SELECT TO_CHAR(M.DTMOV, 'YYYY-MM'), M.CODOPER, COUNT(*), SUM(M.QT), SUM(M.QT * M.PUNIT)
                    FROM PCMOV M
                   WHERE M.DTMOV >= :ini AND M.CODOPER IN ('EI', 'SI') AND M.ROTINACAD LIKE '%1147%'
                     AND {_in_filial('M.CODFILIAL')}
                   GROUP BY TO_CHAR(M.DTMOV, 'YYYY-MM'), M.CODOPER"""
        with conn.cursor() as cur:
            cur.execute(sql, {"ini": _data_inicial()})
            pcmov = {(r[0], r[1]): (int(r[2]), float(r[3] or 0), float(r[4] or 0)) for r in cur.fetchall()}
        log.info("1147 x PCMOV (ajustes, unidades, R$) — mes a mes:")
        for k in sorted(set(banco) | set(pcmov)):
            b, m = banco.get(k, [0, 0.0, 0.0]), pcmov.get(k, (0, 0.0, 0.0))
            bate = b[0] == m[0] and abs(b[1] - m[1]) < 0.01 and abs(b[2] - m[2]) <= 1.0
            log.info("   %s %s  log %5d %12.3f %14.2f | PCMOV %5d %12.3f %14.2f  %s",
                     k[0], k[1], b[0], b[1], b[2], m[0], m[1], m[2], "ok" if bate else "<-- DIFERENTE")
            problemas += 0 if bate else 1

    log.info("=" * 70)
    if problemas:
        log.warning("%d ponto(s) para olhar antes de confiar na carga.", problemas)
    else:
        log.info("Tudo confere. Pode rodar o sync_inventario.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
