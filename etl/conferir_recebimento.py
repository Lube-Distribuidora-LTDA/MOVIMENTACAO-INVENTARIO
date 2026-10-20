#!/usr/bin/env python3
"""
conferir_recebimento.py — prova, contra o proprio WinThor, que o RECEBIMENTO DE COMPRA (1301)
entra no estoque BLOQUEADO na quantidade de PCMOV.QTBLOQUEADA. Nao grava nada.

Por que existe: o livro da 266 (PCLOGDESBLOQUEIO) nao registra o bloqueio do recebimento,
so a liberacao. O painel le o recebimento da linha da nota (PCMOV.QTBLOQUEADA). Esta
conferencia usa a FOTO DIARIA do estoque (PCHISTEST.QTBLOQUEADA, gerada de madrugada) como
documento da fonte: para cada produto, a variacao do bloqueado entre a foto do fim de um mes
e a do mes seguinte tem que ser o que o livro explica + o recebimento + a devolucao ao
fornecedor/remessa (PCMOV com QTBLOQUEADA, saidas). Se somar o recebimento derruba o que
sobra sem explicacao, o recebimento entra bloqueado.

Referencia (rodada de 2026-10-20 08:43, set/2025 a out/2026, |o que sobra| em unidades):
    filial  1: sem o recebimento 35.632.097  ->  com o recebimento 4.501.843
    filial  7: 1.602.698 -> 278.074     filial 10: 467.285 -> 0
    filial 11: 9.503 -> 6.103           filial 12: 1.713.390 -> 260.314
Produto x mes que so fecha SEM o recebimento (recebimento que nao bloqueou): 118 de 32.975
(0,4%) na filial 1 e nenhum nas outras. O que ainda sobra vem do proprio livro (ex.: o WMS
grava liberacao que nao mexe no saldo) e de quando a foto e gerada, nao do recebimento.

Uso:  python conferir_recebimento.py [filiais separadas por virgula] [AAAA-MM-DD inicio]
      python conferir_recebimento.py 1,12 2025-09-01
"""

from __future__ import annotations

import sys
from bisect import bisect_left
from collections import Counter, defaultdict
from datetime import date, datetime

import bi_comum as bi

log = bi.configurar_log("conferir_recebimento.log")


def _grupo(p: str | None) -> str:
    p = p or ""
    if p == "PCSIS266":
        return "m266"
    if p.startswith("[PCSIS266"):
        return "v266"
    if p.startswith("WMS"):
        return "wms"
    for k, g in (("1303", "dev"), ("1346", "dev"), ("1361", "dev"), ("1316", "can"), ("552", "aut"), ("1122", "mon")):
        if k in p:
            return g
    return "outro"


def _sinal_livro(prog, qb, qd) -> float:
    """quanto o registro do livro mexe no bloqueado, lido como a view inventario.vw_movimento."""
    g, qb, qd = _grupo(prog), float(qb or 0), float(qd or 0)
    if g == "m266":
        return max(qb, 0) - max(qd, 0)
    if g in ("v266", "wms", "aut"):
        return -qd
    if g in ("dev", "mon"):
        return qb
    return 0.0


def _ts(d, h, m) -> datetime:
    try:
        return datetime(d.year, d.month, d.day, int(h or 0), int(m or 0))
    except (TypeError, ValueError):
        return datetime(d.year, d.month, d.day)


def conferir(conn, fil: str, ini: date) -> None:
    b = {"f": fil, "ini": ini}

    def ler(sql):
        with conn.cursor() as cur:
            cur.arraysize = 50000
            cur.execute(sql, b)
            return cur.fetchall()

    livro = ler("""SELECT CODPROD, DTDESBLOQUEIO, PROGRAMA, QTBLOQUEADA, QTDESBLOQUEADA
                     FROM PCLOGDESBLOQUEIO WHERE CODFILIAL = :f AND DTDESBLOQUEIO >= :ini - 40""")
    # recebimento (hora da nota) e as outras linhas do PCMOV que mexem no bloqueado
    mov = ler("""SELECT M.CODPROD, NVL(N.DTENT, M.DTMOV), NVL(N.HORALANC, M.HORALANC), NVL(N.MINUTOLANC, M.MINUTOLANC),
                        M.CODOPER, REGEXP_SUBSTR(M.ROTINACAD, '[0-9]{3,4}'), M.QTBLOQUEADA
                   FROM PCMOV M
                   LEFT JOIN (SELECT NUMTRANSENT, MIN(DTENT) DTENT, MIN(HORALANC) HORALANC, MIN(MINUTOLANC) MINUTOLANC
                                FROM PCNFENT WHERE ESPECIE <> 'CT' AND DTENT >= :ini - 80 GROUP BY NUMTRANSENT) N
                          ON N.NUMTRANSENT = M.NUMTRANSENT AND M.CODOPER IN ('E', 'EB', 'ER') AND M.QT > 0
                  WHERE M.CODFILIAL = :f AND M.DTMOV >= :ini - 40 AND NVL(M.QTBLOQUEADA, 0) <> 0""")
    fotos_brutas = ler("""SELECT CODPROD, DATA, NVL(QTBLOQUEADA, 0), DTGERACAO FROM PCHISTEST
                           WHERE CODFILIAL = :f AND DATA >= :ini - 40""")

    ev = defaultdict(list)
    for p, dt, prog, qb, qd in livro:
        ev[p].append((dt, "livro", _sinal_livro(prog, qb, qd)))
    for p, d, h, m, oper, rot, qb in mov:
        if oper in ("E", "EB", "ER") and rot == "1301":
            ev[p].append((_ts(d, h, m), "receb", float(qb)))
        elif rot in ("1303", "1346", "1361", "1122") or (oper == "ED" and rot == "1316"):
            continue                      # estes ja gravam no livro: nao contar duas vezes
        else:
            ev[p].append((_ts(d, h, m), "outros", (-1.0 if (oper or "").startswith("S") else 1.0) * float(qb)))
    for k in ev:
        ev[k].sort(key=lambda e: e[0])
    prods = set(ev)
    fotos = defaultdict(list)
    for p, d, qb, g in fotos_brutas:
        if p in prods:
            fotos[p].append((d, float(qb), g))

    cat, sem, com = Counter(), 0.0, 0.0
    for p in prods:
        ult = {}
        for d, qb, g in sorted(fotos.get(p, [])):
            ult[(d.year, d.month)] = (d, qb, g)          # ultima foto de cada mes
        meses = sorted(ult)
        evs = ev[p]
        tl = [e[0] for e in evs]
        for m0, m1 in zip(meses, meses[1:]):
            (d0, b0, g0), (d1, b1, g1) = ult[m0], ult[m1]
            if d1.date() < ini or g0 is None or g1 is None:
                continue
            jan = evs[bisect_left(tl, g0):bisect_left(tl, g1)]
            delta = b1 - b0
            if not jan and abs(delta) < 0.001:
                continue
            explicado = sum(e[2] for e in jan if e[1] != "receb")
            rec = sum(e[2] for e in jan if e[1] == "receb")
            s_sem, s_com = delta - explicado, delta - explicado - rec
            sem += abs(s_sem)
            com += abs(s_com)
            tem = abs(rec) > 0.001
            if abs(s_com) < 0.001:
                cat["fecha somando o recebimento" + (" (teve recebimento)" if tem else " (sem recebimento no mes)")] += 1
            elif abs(s_sem) < 0.001:
                cat["fecha SO SEM o recebimento (nao entrou bloqueado)"] += 1
            else:
                cat["nao fecha" + (" (teve recebimento)" if tem else " (sem recebimento no mes)")] += 1
    tot = sum(cat.values()) or 1
    log.info("=" * 78)
    log.info("Filial %s, desde %s: %d produto x mes com movimento", fil, ini, tot)
    for k in sorted(cat):
        log.info("   %-58s %7d  %5.1f%%", k, cat[k], 100 * cat[k] / tot)
    log.info("   |o que sobra sem explicacao| SEM somar o recebimento: %16s un.", f"{sem:,.0f}".replace(",", "."))
    log.info("   |o que sobra sem explicacao| SOMANDO o recebimento:   %16s un.", f"{com:,.0f}".replace(",", "."))


def main() -> int:
    bi.carregar_env()
    from consultas_inventario import filiais
    fils = sys.argv[1].split(",") if len(sys.argv) > 1 else [str(f) for f in filiais()]
    ini = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date(2025, 9, 1)
    with bi.conectar_oracle(bi.OracleConfig.from_env()) as conn:
        for f in fils:
            conferir(conn, f.strip(), ini)
    return 0


if __name__ == "__main__":
    sys.exit(main())
