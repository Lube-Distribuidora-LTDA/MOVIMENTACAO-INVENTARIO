/* =============================================================================
 * pag-posicao.js — ESTOQUE BLOQUEADO HOJE (PCEST da última carga).
 * Quanto está parado no bloqueado, quanto disso é avaria, onde e há quanto tempo
 * (dias desde o último movimento que colocou o produto no bloqueado).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "posicao", grupo: "Rotina 266", menu: "Bloqueado hoje", icone: "armazem",
  titulo: "Estoque bloqueado hoje", olho: "Posição do PCEST na última carga", semPeriodo: true,
  filtros: ["filial", "depto", "secao", "fornecedor", "produto"],
  render: render,
});

/* faixas de "há quanto tempo" (dias desde o último bloqueio registrado) */
var FAIXAS = [
  { id: 0, rot: "Até 7 dias", ate: 7 }, { id: 1, rot: "8 a 30 dias", ate: 30 }, { id: 2, rot: "31 a 90 dias", ate: 90 },
  { id: 3, rot: "91 a 180 dias", ate: 180 }, { id: 4, rot: "Mais de 180 dias", ate: 1e9 }, { id: 5, rot: "Sem bloqueio no livro desde 2025", ate: null },
  { id: 6, rot: "Mais de 90 dias", ate: null },
];
function faixaDe(dias) { if (dias == null) return 5; for (var i = 0; i < 5; i++) if (dias <= FAIXAS[i].ate) return i; return 4; }
L.FAIXAS_IDADE = FAIXAS;

function render(raiz, params) {
  var ES = L.ES, idx = L.filtrarEs(L.spec()), r = L.resumoEs(idx), hoje = L.hojeDia();
  var todo = L.resumoEs(L.filtrarEs({ f: L.spec().f, todos: true }));       // base do %: o estoque inteiro, não só o bloqueado
  r.ve = todo.ve; r.pct = r.ve ? r.vb / r.ve : null;
  var faixa = params && params.faixa != null ? params.faixa : null;
  var linhas = [], porFaixa = FAIXAS.slice(0, 6).map(function () { return { vb: 0, va: 0, n: 0 }; });
  for (var j = 0; j < idx.length; j++) {
    var s = idx[j], dias = ES.ultBloq[s] >= 0 ? hoje - ES.ultBloq[s] : null, fx = faixaDe(dias);
    porFaixa[fx].vb += ES.b[s] * ES.c[s]; porFaixa[fx].va += ES.a[s] * ES.c[s]; porFaixa[fx].n++;
    if (faixa == null || faixa === fx || (faixa === 6 && (fx === 3 || fx === 4))) linhas.push({ s: s, dias: dias, fx: fx });
  }

  raiz.appendChild(L.kpis(
    L.kpi({ icone: "armazem", rot: "Bloqueado hoje", valor: r.vb, fmt: L.fRk, fmtTitulo: L.fR, classe: "heroi", leg: L.h("span", { text: L.fQ(r.qb) + " un. · " + L.fInt(r.skus) + " SKUs" }) }),
    L.kpi({ icone: "alerta", rot: "Em avaria", valor: r.va, fmt: L.fRk, fmtTitulo: L.fR, classe: r.va ? "perigo" : "zero", leg: L.h("span", { text: L.fQ(r.qa) + " un. indenizadas · " + L.fPct(r.vb ? r.va / r.vb : null, 1) + " do bloqueado" }) }),
    L.kpi({ icone: "cadeado", rot: "Outros bloqueios", valor: r.vo, fmt: L.fRk, fmtTitulo: L.fR, classe: r.vo ? "atencao" : "zero", leg: L.h("span", { text: "conferência, recebimento, devolução…" }) }),
    L.kpi({ icone: "percent", rot: "Do estoque está bloqueado", valor: r.pct, fmt: function (v) { return L.fPct(v, 1); }, classe: r.pct > 0.05 ? "atencao" : "", leg: L.h("span", { text: "de " + L.fRc(r.ve) + " em estoque (custo)" }) }),
    L.kpi({ icone: "relogio", rot: "Bloqueado há mais de 90 dias", valor: porFaixa[3].vb + porFaixa[4].vb, fmt: L.fRk, fmtTitulo: L.fR, classe: porFaixa[3].vb + porFaixa[4].vb ? "atencao" : "zero",
            leg: L.h("span", { text: L.fInt(porFaixa[3].n + porFaixa[4].n) + " produtos × filial · último bloqueio há mais de 90 dias" }), aoClicar: function () { L.irPara("posicao", { faixa: 6 }); } })));

  // ---------------- idade
  var pIdade = L.painel({ titulo: "Há quanto tempo está bloqueado", sub: "R$ bloqueado por dias desde o último bloqueio · clique para filtrar a lista", classe: "c-6" });
  var gI = L.h("div"); pIdade.corpo.appendChild(gI);
  var cA = L.cssVar("--d5"), cO = L.cssVar("--d1");
  L.graf.colunas(gI, {
    categorias: ["≤ 7 dias", "8–30 dias", "31–90 dias", "91–180 dias", "> 180 dias", "Sem registro"], modo: "empilhado", altura: 270, tipo: "moeda", fmt: L.fRc,
    series: [{ nome: "Avaria", cor: cA, valores: porFaixa.map(function (x) { return x.va; }) }, { nome: "Outros bloqueios", cor: cO, valores: porFaixa.map(function (x) { return x.vb - x.va; }) }],
    corBarra: function (ci, si) { var dentro = faixa == null || faixa === ci || (faixa === 6 && (ci === 3 || ci === 4)); return !dentro ? "var(--s3)" : si === 0 ? cA : cO; },
    dica: function (i) { var x = porFaixa[i]; return { titulo: FAIXAS[i].rot, linhas: [{ rot: "Bloqueado", val: L.fR(x.vb) }, { rot: "Avaria", cor: cA, val: L.fR(x.va) }, { rot: "Outros", cor: cO, val: L.fR(x.vb - x.va) }, { rot: "Produtos × filial", val: L.fInt(x.n) }], clique: faixa === i ? "Clique para mostrar todas as faixas" : "Clique para filtrar a lista" }; },
    aoClicar: function (i) { L.irPara("posicao", faixa === i ? {} : { faixa: i }); },
  });
  pIdade.corpo.appendChild(L.graf.legenda([{ rot: "Avaria (indenizada)", cor: cA }, { rot: "Outros bloqueios", cor: cO }]));

  // ---------------- filiais
  var pFil = L.painel({ titulo: "Por filial", sub: "avaria × outros bloqueios", classe: "c-6" });
  var gf = L.agruparEs(idx, "filial"), gF = L.h("div"); pFil.corpo.appendChild(gF);
  L.graf.barras100(gF, {
    linhas: gf.map(function (g) { return { rot: L.nomeDe("filial", g.k), partes: [{ valor: g.va, cor: cA }, { valor: g.vo, cor: cO }] }; }),
    fmtTotal: function (pt) { return L.fRc(pt[0].valor + pt[1].valor); },
    dica: function (i) { var g = gf[i]; return { titulo: L.nomeDe("filial", g.k), linhas: [{ rot: "Bloqueado", val: L.fR(g.vb) }, { rot: "Avaria", cor: cA, val: L.fR(g.va) }, { rot: "Outros", cor: cO, val: L.fR(g.vo) }, { rot: "Linhas", val: L.fInt(g.n) }] }; },
    aoClicar: function (i, s, ev) { L.clique("filial", gf[i].k, ev, { fonte: "es" }); },
  });
  raiz.appendChild(L.grade(pIdade, pFil));

  // ---------------- departamentos e fornecedores
  var pDep = L.painel({ titulo: "Departamentos", sub: "R$ bloqueado · clique para abrir · Ctrl+clique filtra", classe: "c-6" });
  barrasEs(pDep.corpo, idx, "depto", 8);
  var pFor = L.painel({ titulo: "Fornecedores", sub: "R$ bloqueado · clique para abrir · Ctrl+clique filtra", classe: "c-6" });
  barrasEs(pFor.corpo, idx, "fornecedor", 8);
  raiz.appendChild(L.grade(pDep, pFor));

  // ---------------- lista
  var P = L.P, D = L.D;
  var tab = L.tabela({
    titulo: "Estoque bloqueado hoje", arquivo: "estoque-bloqueado-hoje", aba: "Bloqueado hoje", rank: true, porPagina: 25, linhas: linhas, ordem: { id: "vb", desc: true },
    foto: function (x) { return ES.p[x.s]; }, buscaTexto: function (x) { var p = ES.p[x.s]; return P.cod[p] + " " + P.desc[p] + " " + L.nomeDe("fornecedor", P.forn[p]); },
    filtrosTexto: function () { return L.descricaoFiltros([["Faixa", faixa == null ? "Todas" : FAIXAS[faixa].rot]], true); },
    colunas: [
      { id: "nome", titulo: "Produto", tipo: "texto", valor: function (x) { return P.desc[ES.p[x.s]]; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (x) { return P.cod[ES.p[x.s]]; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "fil", titulo: "Filial", tipo: "inteiro", valor: function (x) { return ES.f[x.s]; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (x) { return L.nomeDe("fornecedor", P.forn[ES.p[x.s]]); }, essencial: false },
      { id: "dep", titulo: "Departamento", tipo: "texto", valor: function (x) { return L.nomeDe("depto", P.dep[ES.p[x.s]]); }, essencial: false },
      { id: "est", titulo: "Estoque", tipo: "num", valor: function (x) { return ES.e[x.s]; }, fmt: L.fQ, exportarTipo: "inteiro", essencial: false },
      { id: "qb", titulo: "Bloqueado (un.)", tipo: "num", valor: function (x) { return ES.b[x.s]; }, fmt: L.fQ, exportarTipo: "inteiro" },
      { id: "qa", titulo: "Avaria (un.)", tipo: "num", valor: function (x) { return ES.a[x.s]; }, fmt: function (v) { return v ? L.fQ(v) : ""; }, exportarTipo: "inteiro" },
      { id: "c", titulo: "Custo un.", tipo: "num2", valor: function (x) { return ES.c[x.s]; }, exportarTipo: "moeda", somar: false, essencial: false },
      { id: "vb", titulo: "R$ bloqueado", tipo: "moedaInt", valor: function (x) { return ES.b[x.s] * ES.c[x.s]; }, barra: true, exportarTipo: "moeda" },
      { id: "va", titulo: "R$ avaria", tipo: "moedaInt", valor: function (x) { return ES.a[x.s] * ES.c[x.s]; }, exportarTipo: "moeda" },
      { id: "ult", titulo: "Último bloqueio", tipo: "texto", valor: function (x) { return ES.ultBloq[x.s]; }, fmt: function (v) { return v >= 0 ? L.fDia(v) : "antes de 2025"; }, exp: function (x) { return ES.ultBloq[x.s] >= 0 ? L.fDia(ES.ultBloq[x.s]) : "antes de 2025"; } },
      { id: "dias", titulo: "Dias", tipo: "inteiro", valor: function (x) { return x.dias; }, fmt: function (v) { return v == null ? "—" : L.fInt(v); }, somar: false },
      { id: "mot", titulo: "Motivo do último bloqueio", tipo: "texto", valor: function (x) { var m = ES.motUlt[x.s]; return m < 0 ? "" : L.nomeDe("motivo", D.motivos[m][0]); } },
    ],
    totais: function (res) { var l = res.todas || res.linhas, vb = 0, va = 0; l.forEach(function (x) { vb += ES.b[x.s] * ES.c[x.s]; va += ES.a[x.s] * ES.c[x.s]; });
      return [{ rot: "R$ bloqueado", valor: L.fR(vb), pri: true }, { rot: "R$ avaria", valor: L.fR(va) }, { rot: "Produtos × filial", valor: L.fInt(l.length) }]; },
    aoClicar: function (x, ev) { L.clique("produto", P.cod[ES.p[x.s]], ev); },
  });
  var acoes = faixa != null ? [L.btnPainel("x", "Tirar a faixa " + FAIXAS[faixa].rot, function () { L.irPara("posicao", {}); })] : null;
  raiz.appendChild(L.grade(L.painel({ titulo: "Produtos bloqueados" + (faixa != null ? " · " + FAIXAS[faixa].rot : ""), sub: "um por filial · clique para abrir o relatório do produto", classe: "c-12", semPad: true, corpo: tab, acoes: acoes })));
  raiz.appendChild(L.nota("Posição do PCEST na última carga (" + L.fDataHora(L.META.carga || L.META.gerado_em) + "), valorizada pelo custo financeiro. Avaria (QTINDENIZ) faz parte do bloqueado. \"Último bloqueio\" é o movimento mais recente que colocou o produto no bloqueado desde jan/2025 (bloqueio, avaria ou devolução); o recebimento de compra não aparece no livro do WinThor, então um produto recebido e ainda não armazenado pode aparecer como \"sem registro\"."));
}

function barrasEs(corpo, idx, dim, n) {
  var gr = L.agruparEs(idx, dim), tot = gr.reduce(function (s, g) { return s + g.vb; }, 0), top = gr.slice(0, n), box = L.h("div");
  corpo.appendChild(box);
  L.graf.barras(box, {
    itens: top.map(function (g) { return { rot: L.nomeDe(dim, g.k), valor: g.vb }; }), total: tot, fmt: L.fRc, linhaH: 28,
    cor: function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
    dica: function (i) { var g = top[i]; return { titulo: L.nomeDe(dim, g.k), linhas: [{ rot: "Bloqueado", val: L.fR(g.vb) }, { rot: "Avaria", val: L.fR(g.va) }, { rot: "Produtos × filial", val: L.fInt(g.n) }, { rot: "Participação", val: L.fPct(tot ? g.vb / tot : 0, 1) }] }; },
    aoClicar: function (i, s, ev) { L.clique(dim, top[i].k, ev, { fonte: "es" }); },
  });
}

})();
