#!/usr/bin/env python3
"""
consultas_inventario.py — catalogo de consultas do sistema MOVIMENTACAO DE INVENTARIO.

Duas rotinas do WinThor alimentam este sistema:

    266   Bloquear Produtos no Estoque     -> PCLOGDESBLOQUEIO, o livro de tudo o que
                                              entra e sai do estoque BLOQUEADO: bloqueio
                                              e desbloqueio manual (266), avaria, devolucao
                                              de cliente que entra bloqueada (1303/1346),
                                              liberacao do WMS da Kaizen depois da
                                              armazenagem, cancelamento de devolucao (1316)
    1147  Manutencao de inventario rotativo -> PCINVENTROT (o que foi contado) com
                                              PCLOGATUALIZAINVENT (a diferenca que a
                                              atualizacao lancou no estoque, EI = sobra,
                                              SI = falta). Os mesmos ajustes viram PCMOV
                                              EI/SI, que o diagnostico usa para conferir.

Consultas, uma por tabela de destino, todas no schema `inventario`:

    bloqueio     -> inventario.fato_bloqueio     (um registro por movimento do bloqueado)
    inventario   -> inventario.fato_inventario   (um registro por produto contado)
    posicao      -> inventario.fato_posicao      (estoque, bloqueado, avaria e custo de hoje)
    produto      -> inventario.produto           (descricao, fornecedor, departamento, secao)
    funcionario  -> inventario.funcionario       (quem bloqueou, contou, atualizou)
    motivo       -> inventario.motivo            (motivo do bloqueio = PCTABDEV)
    filial       -> inventario.filial

A CLASSIFICACAO de cada movimento (bloqueio, desbloqueio, avaria, liberacao do WMS,
devolucao...) NAO e feita aqui: ela mora no banco (view inventario.vw_bloqueio), de
proposito. O livro do WinThor grava cada programa de um jeito (ver a view) e, se a
leitura de um campo mudar, muda-se a view, nao se roda carga de novo.

Recortes (opcionais, no ENV):
    INVENTARIO_DATA_INICIAL=2025-01-01   primeira data carregada
    INVENTARIO_FILIAIS=1,7,10,11,12      filiais de distribuicao (vazio = estas)

Por que so estas filiais: o livro de bloqueio tem registros da L LOG (filial 4) e o
PCEST das filiais 3, 4 e 6 (SERMAR, L LOG, IMPERIO) guarda milhoes de reais
"bloqueados" que nao sao mercadoria de galpao. Somar isso no "bloqueado hoje" mentiria.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any

from bi_comum import Consulta, inteiro, texto

FILIAIS_PADRAO = "1,7,10,11,12"


def _data_inicial() -> date:
    bruto = (os.environ.get("INVENTARIO_DATA_INICIAL") or "2025-01-01").strip()
    return datetime.strptime(bruto, "%Y-%m-%d").date()


def filiais() -> list[int]:
    bruto = (os.environ.get("INVENTARIO_FILIAIS") or FILIAIS_PADRAO).strip() or FILIAIS_PADRAO
    return [int(x) for x in bruto.split(",") if x.strip()]


def _in_filial(coluna: str) -> str:
    # CODFILIAL e texto no WinThor ('1', '10'): compara com texto. Os valores vem de
    # int(), entao nao ha texto livre indo para o SQL.
    return f"{coluna} IN ({', '.join(repr(str(f)) for f in filiais())})"


def _num(v: Any) -> float | None:
    return None if v is None else float(v)


# ---------------------------------------------------------------------------
# 266 — livro de bloqueio e desbloqueio (PCLOGDESBLOQUEIO)
# ---------------------------------------------------------------------------
# Cada programa grava os campos de um jeito; os brutos vao inteiros para o banco e a
# view vw_bloqueio le cada um do jeito certo. Conferido produto a produto contra o
# PCEST (13618 e 13662 da filial 1, setembro/outubro de 2026): o saldo fecha.
SQL_BLOQUEIO = """
SELECT L.DTDESBLOQUEIO,
       TO_NUMBER(L.CODFILIAL)  AS CODFILIAL,
       L.CODPROD,
       L.CODFUNCDESBLOQUEIO     AS CODFUNC,
       L.CODDEVOL,
       L.PROGRAMA,
       L.QTBLOQUEADA,
       L.QTDESBLOQUEADA,
       L.QTINDENIZ,
       L.QTBLOQUEADAANT,
       L.QTINDENIZANT,
       L.NUMTRANSENT
  FROM PCLOGDESBLOQUEIO L
 WHERE L.DTDESBLOQUEIO >= :ini
   AND {filial}
"""

COLUNAS_BLOQUEIO = (
    "dt", "codfilial", "codprod", "codfunc", "coddevol", "programa",
    "qtbloqueada", "qtdesbloqueada", "qtindeniz", "qtbloqueadaant", "qtindenizant", "numtransent",
)


def _mapear_bloqueio(r: dict[str, Any]) -> tuple:
    return (
        r["dtdesbloqueio"], inteiro(r["codfilial"]), inteiro(r["codprod"]), inteiro(r["codfunc"]),
        inteiro(r["coddevol"]), texto(r["programa"]),
        _num(r["qtbloqueada"]), _num(r["qtdesbloqueada"]), _num(r["qtindeniz"]),
        _num(r["qtbloqueadaant"]), _num(r["qtindenizant"]), inteiro(r["numtransent"]) or None,
    )


# ---------------------------------------------------------------------------
# 1147 — inventario rotativo (PCINVENTROT + PCLOGATUALIZAINVENT)
# ---------------------------------------------------------------------------
# PCINVENTROT tem TODO produto contado; PCLOGATUALIZAINVENT so o que deu diferenca na
# atualizacao (sem linha no log = contagem igual ao estoque; conferido: nenhum produto
# sem log tem contagem diferente do estoque). A chave do inventario e NUMINVENT +
# CODFILIAL + CODPROD (+ CODLOCAL, sempre '0' hoje; o diagnostico avisa se mudar).
SQL_INVENTARIO = """
SELECT R.NUMINVENT,
       TO_NUMBER(R.CODFILIAL)  AS CODFILIAL,
       R.CODPROD,
       R.CODLOCAL,
       R.DATA,
       R.DATACONT1,
       R.DTATUALIZACAO,
       R.DTCANCEL,
       R.CODFUNCCONT1,
       R.CODFUNCATUALIZACAO,
       R.CODFUNCMONTAGEM,
       R.QT1, R.QT2, R.QT3,
       R.QTESTGER              AS QTESTGER_INV,
       R.CUSTO,
       G.QTINVENT,
       G.QTESTGER              AS QTESTGER_LOG,
       G.QTDIF,
       G.VLDIF,
       G.VLCUSTO,
       G.TIPOAJUSTE
  FROM PCINVENTROT R
  LEFT JOIN PCLOGATUALIZAINVENT G
         ON G.NUMINVENT = R.NUMINVENT AND G.CODPROD = R.CODPROD AND G.CODFILIAL = R.CODFILIAL
 WHERE R.DATA >= :ini
   AND {filial}
"""

COLUNAS_INVENTARIO = (
    "numinvent", "codfilial", "codprod", "codlocal", "data", "dt_contagem", "dt_atualizacao", "dt_cancel",
    "codfunc_contagem", "codfunc_atualizacao", "codfunc_montagem", "qt1", "qt2", "qt3",
    "qtestger_inv", "custo", "qtinvent", "qtestger_log", "qtdif", "vldif", "vlcusto", "tipoajuste",
)


def _mapear_inventario(r: dict[str, Any]) -> tuple:
    return (
        inteiro(r["numinvent"]), inteiro(r["codfilial"]), inteiro(r["codprod"]), texto(r["codlocal"]) or "0",
        r["data"].date() if r["data"] else None, r["datacont1"], r["dtatualizacao"], r["dtcancel"],
        inteiro(r["codfunccont1"]), inteiro(r["codfuncatualizacao"]), inteiro(r["codfuncmontagem"]),
        _num(r["qt1"]), _num(r["qt2"]), _num(r["qt3"]), _num(r["qtestger_inv"]), _num(r["custo"]),
        _num(r["qtinvent"]), _num(r["qtestger_log"]), _num(r["qtdif"]), _num(r["vldif"]), _num(r["vlcusto"]),
        texto(r["tipoajuste"]),
    )


# ---------------------------------------------------------------------------
# Posicao de hoje (PCEST): estoque, bloqueado, avaria e o custo que valoriza tudo
# ---------------------------------------------------------------------------
# CUSTOFIN e o custo que a propria 1147 usa para valorizar a diferenca
# (PCLOGATUALIZAINVENT.CUSTOUTILIZADO = 'F'). O livro de bloqueio nao guarda custo:
# o painel valoriza bloqueio e desbloqueio pelo custo financeiro de HOJE (dito na tela).
# QTINDENIZ (avaria) e parte de QTBLOQUEADA.
SQL_POSICAO = """
SELECT TO_NUMBER(E.CODFILIAL) AS CODFILIAL,
       E.CODPROD,
       E.QTESTGER,
       E.QTRESERV,
       E.QTBLOQUEADA,
       E.QTINDENIZ,
       E.CUSTOFIN,
       E.DTULTENT
  FROM PCEST E
 WHERE {filial}
   AND (NVL(E.QTESTGER, 0) <> 0 OR NVL(E.QTBLOQUEADA, 0) <> 0 OR NVL(E.QTINDENIZ, 0) <> 0
        OR E.DTULTENT >= :ini)
"""

COLUNAS_POSICAO = ("codfilial", "codprod", "qtestger", "qtreserv", "qtbloqueada", "qtindeniz", "custofin", "dtultent")


def _mapear_posicao(r: dict[str, Any]) -> tuple:
    return (
        inteiro(r["codfilial"]), inteiro(r["codprod"]), _num(r["qtestger"]), _num(r["qtreserv"]),
        _num(r["qtbloqueada"]), _num(r["qtindeniz"]), _num(r["custofin"]),
        r["dtultent"].date() if r["dtultent"] else None,
    )


# ---------------------------------------------------------------------------
# Cadastros pequenos
# ---------------------------------------------------------------------------
# Produto: o core.dim_produto (dono: BI COMPRAS) nao tem departamento, secao nem
# embalagem. Ate o dono ganhar essas colunas, este sistema le o cadastro do WinThor
# por conta propria — sem depender da ordem em que os outros ETLs rodam.
SQL_PRODUTO = """
SELECT P.CODPROD,
       P.DESCRICAO,
       P.EMBALAGEM,
       P.UNIDADE,
       P.CODAUXILIAR,
       P.CODFORNEC,
       F.FORNECEDOR,
       P.CODEPTO,
       D.DESCRICAO AS DEPARTAMENTO,
       P.CODSEC,
       S.DESCRICAO AS SECAO,
       P.OBS2,
       P.DTEXCLUSAO
  FROM PCPRODUT P
  LEFT JOIN PCFORNEC F ON F.CODFORNEC = P.CODFORNEC
  LEFT JOIN PCDEPTO D ON D.CODEPTO = P.CODEPTO
  LEFT JOIN PCSECAO S ON S.CODSEC = P.CODSEC
"""

COLUNAS_PRODUTO = ("codprod", "descricao", "embalagem", "unidade", "ean", "codfornec", "fornecedor",
                   "codepto", "departamento", "codsec", "secao", "fora_de_linha", "excluido")


def _mapear_produto(r: dict[str, Any]) -> tuple:
    return (
        inteiro(r["codprod"]), texto(r["descricao"]), texto(r["embalagem"]), texto(r["unidade"]),
        texto(r["codauxiliar"]), inteiro(r["codfornec"]), texto(r["fornecedor"]),
        inteiro(r["codepto"]), texto(r["departamento"]), inteiro(r["codsec"]), texto(r["secao"]),
        (texto(r["obs2"]) or "").upper() == "FL", r["dtexclusao"] is not None,
    )


SQL_FUNCIONARIO = """
SELECT E.MATRICULA, E.NOME, E.NOME_GUERRA, E.FUNCAO, E.SITUACAO
  FROM PCEMPR E
"""
COLUNAS_FUNCIONARIO = ("matricula", "nome", "nome_guerra", "funcao", "situacao")


def _mapear_funcionario(r: dict[str, Any]) -> tuple:
    return (inteiro(r["matricula"]), texto(r["nome"]), texto(r["nome_guerra"]), texto(r["funcao"]), texto(r["situacao"]))


SQL_MOTIVO = "SELECT CODDEVOL, MOTIVO FROM PCTABDEV"
COLUNAS_MOTIVO = ("coddevol", "motivo")


def _mapear_motivo(r: dict[str, Any]) -> tuple:
    # O WinThor guarda motivos com " ." e espacos sobrando ("PEDIDO ERRADO ."); fica so o nome.
    m = (texto(r["motivo"]) or "").rstrip(" .").strip()
    return (inteiro(r["coddevol"]), m or None)


SQL_FILIAL = "SELECT CODIGO, RAZAOSOCIAL, FANTASIA, CIDADE, UF FROM PCFILIAL"
COLUNAS_FILIAL = ("codfilial", "razao_social", "fantasia", "cidade", "uf")


def _mapear_filial(r: dict[str, Any]) -> tuple | None:
    return (inteiro(r["codigo"]), texto(r["razaosocial"]), texto(r["fantasia"]), texto(r["cidade"]), texto(r["uf"]))


# ---------------------------------------------------------------------------
# Catalogo
# ---------------------------------------------------------------------------
def _montar() -> list[Consulta]:
    ini = _data_inicial()
    return [
        Consulta(
            nome="bloqueio",
            descricao="Livro de bloqueio/desbloqueio do estoque (rotina 266, PCLOGDESBLOQUEIO)",
            pagina="INVENTARIO",
            sql=SQL_BLOQUEIO.format(filial=_in_filial("L.CODFILIAL")),
            destino="inventario.fato_bloqueio",
            colunas=COLUNAS_BLOQUEIO,
            mapear=_mapear_bloqueio,
            binds={"ini": ini},
            streaming=True,
        ),
        Consulta(
            nome="inventario",
            descricao="Inventario rotativo: produto contado x estoque (rotina 1147)",
            pagina="INVENTARIO",
            sql=SQL_INVENTARIO.format(filial=_in_filial("R.CODFILIAL")),
            destino="inventario.fato_inventario",
            colunas=COLUNAS_INVENTARIO,
            mapear=_mapear_inventario,
            binds={"ini": ini},
        ),
        Consulta(
            nome="posicao",
            descricao="Posicao de hoje: estoque, bloqueado, avaria e custo (PCEST)",
            pagina="INVENTARIO",
            sql=SQL_POSICAO.format(filial=_in_filial("E.CODFILIAL")),
            destino="inventario.fato_posicao",
            colunas=COLUNAS_POSICAO,
            mapear=_mapear_posicao,
            binds={"ini": ini},
            tolerancia_pct=0.15,
        ),
        Consulta(nome="produto", descricao="Cadastro de produto (descricao, fornecedor, departamento, secao)",
                 pagina="INVENTARIO", sql=SQL_PRODUTO, destino="inventario.produto",
                 colunas=COLUNAS_PRODUTO, mapear=_mapear_produto, chave_conflito=("codprod",)),
        Consulta(nome="funcionario", descricao="Funcionarios (quem bloqueia, conta e atualiza)",
                 pagina="INVENTARIO", sql=SQL_FUNCIONARIO, destino="inventario.funcionario",
                 colunas=COLUNAS_FUNCIONARIO, mapear=_mapear_funcionario, chave_conflito=("matricula",)),
        Consulta(nome="motivo", descricao="Motivos (PCTABDEV)", pagina="INVENTARIO", sql=SQL_MOTIVO,
                 destino="inventario.motivo", colunas=COLUNAS_MOTIVO, mapear=_mapear_motivo,
                 chave_conflito=("coddevol",)),
        Consulta(nome="filial", descricao="Filiais", pagina="INVENTARIO", sql=SQL_FILIAL,
                 destino="inventario.filial", colunas=COLUNAS_FILIAL, mapear=_mapear_filial,
                 chave_conflito=("codfilial",)),
    ]


def catalogo() -> list[Consulta]:
    """Monta o catalogo na hora (o ENV ja foi carregado pelo orquestrador)."""
    return _montar()


def selecionar(nomes: list[str] | None = None) -> list[Consulta]:
    todas = catalogo()
    if not nomes:
        # cadastros primeiro: a carga dos fatos nao depende deles, mas o painel sim
        ordem = ["filial", "motivo", "funcionario", "produto", "posicao", "inventario", "bloqueio"]
        return sorted(todas, key=lambda c: ordem.index(c.nome))
    indice = {c.nome: c for c in todas}
    faltando = [n for n in nomes if n not in indice]
    if faltando:
        raise SystemExit(f"Consulta(s) inexistente(s): {', '.join(faltando)}. Use --listar.")
    return [indice[n] for n in nomes]
