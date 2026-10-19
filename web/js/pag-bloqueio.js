/* =============================================================================
 * pag-bloqueio.js — ROTINA 266: bloqueio, desbloqueio e avaria feitos à mão.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var FIXO = { rotina: [0] };            // só o que a 266 gravou (tipos 1 a 5)

L.registrarPagina({
  id: "bloqueios", grupo: "Rotina 266", menu: "Bloqueios e avarias", icone: "cadeado",
  titulo: "Bloqueios e avarias", olho: "Rotina 266 · Bloquear produtos no estoque",
  filtros: ["filial", "tipo", "motivo", "func", "depto", "fornecedor", "produto"],
  mais: ["secao", "dow", "hora"],
  render: render,
});

function render(raiz) {
  var c = L.ctxEv(FIXO), r = c.res, med = L.medida(), M = L.MEDIDAS[med], es = L.resumoEs(L.filtrarEs(L.spec()));
  var aviso = L.avisoSuspeitos(c.idx); if (aviso) raiz.appendChild(aviso);
  var bloq = function (x) { return x.porTipo[1] + x.porTipo[2]; }, nb = function (x) { return x.nTipo[1] + x.nTipo[2]; };
  var desb = function (x) { return x.porTipo[4]; }, baixa = function (x) { return x.vab; };
  var abrir = function (titulo, tipos) { return function () { L.abrirDossie({ titulo: titulo, f: { rotina: [0], tipo: tipos } }); }; };

  raiz.appendChild(L.kpis(
    L.kpi({ icone: "cadeado", rot: "Bloqueado na 266", valor: bloq(r), fmt: L.fRk, fmtTitulo: L.fR, classe: "heroi", cmp: c.kc(bloq, true),
            leg: L.h("span", { text: L.fInt(nb(r)) + " bloqueios · " + L.fQ(r.qTipo[1] + r.qTipo[2]) + " un." }), aoClicar: abrir("Bloqueios na 266", [1, 2]) }),
    L.kpi({ icone: "destravar", rot: "Desbloqueado na 266", valor: desb(r), fmt: L.fRk, fmtTitulo: L.fR, classe: desb(r) ? "ok" : "zero", cmp: c.kc(desb),
            leg: L.h("span", { text: L.fInt(r.nTipo[4]) + " desbloqueios · " + L.fQ(r.qTipo[4]) + " un." }), aoClicar: abrir("Desbloqueios na 266", [4]) }),
    L.kpi({ icone: "alerta", rot: "Avaria registrada", valor: r.va266, fmt: L.fRk, fmtTitulo: L.fR, classe: r.va266 ? "perigo" : "zero", cmp: c.kc("va266", true),
            leg: L.h("span", { text: L.fQ(r.qa266) + " un. · " + L.fInt(r.nTipo[2] + r.nTipo[3]) + " registros" }), aoClicar: abrir("Avaria registrada na 266", [2, 3]) }),
    L.kpi({ icone: "verificar", rot: "Baixa de avaria", valor: baixa(r), fmt: L.fRk, fmtTitulo: L.fR, classe: baixa(r) ? "violeta" : "zero", cmp: c.kc(baixa),
            leg: L.h("span", { text: L.fQ(r.qab) + " un. desbloqueadas como avaria" }), aoClicar: abrir("Baixa de avaria na 266", [5]) }),
    L.kpi({ icone: "armazem", rot: "Bloqueado hoje", valor: es.vb, fmt: L.fRk, fmtTitulo: L.fR, classe: es.vb ? "atencao" : "zero",
            leg: L.h("span", { text: L.fRc(es.va) + " em avaria · posição do PCEST" }), ajuda: "Posição atual (não depende do período)", aoClicar: function () { L.irPara("posicao"); } })));

  // ---------------- bloqueio × desbloqueio
  var s = L.serieEv(c.idx, c.p, true), gran = s.gran;
  var pEv = L.painel({ titulo: "Bloqueado × desbloqueado por " + (gran === "dia" ? "dia" : "mês"), sub: "valor ao custo de hoje · clique numa coluna para abrir", classe: "c-12" });
  var g = L.h("div"); pEv.corpo.appendChild(g);
  var cB = L.cssVar("--d5"), cD = L.cssVar("--d4"), cA = L.cssVar("--d7");
  var serieT = function (ks) { return s.chaves.map(function (x, i) { return ks.reduce(function (a, k) { return a + s.tipo[k][i]; }, 0); }); };
  var vb = serieT([1, 2]), vd = serieT([4, 5]);
  L.graf.colunas(g, {
    categorias: s.rot, modo: "agrupado", altura: 290, tipo: "moeda", fmt: L.fRc, rotulos: s.chaves.length <= 14,
    series: [{ nome: "Bloqueado", cor: cB, valores: vb }, { nome: "Desbloqueado", cor: cD, valores: vd }],
    dica: function (i) { var k = s.chaves[i]; return { titulo: gran === "dia" ? L.nomeDe("dia", k) : L.fMesKLongo(k), linhas: [
      { rot: "Bloqueado (manual + avaria)", cor: cB, val: L.fR(vb[i]) }, { rot: "  · por avaria", val: L.fR(s.tipo[2][i]) },
      { rot: "Desbloqueado (manual + baixa de avaria)", cor: cD, val: L.fR(vd[i]) }, { rot: "Saldo", val: (vb[i] - vd[i] >= 0 ? "+" : "") + L.fR(vb[i] - vd[i]) }] }; },
    aoClicar: function (i, si) { var k = s.chaves[i]; L.abrirDossie({ dim: gran, id: k, f: { rotina: [0], tipo: si === 1 ? [4, 5] : [1, 2] }, titulo: (gran === "dia" ? L.nomeDe("dia", k) : L.fMesKLongo(k)) + " · " + (si === 1 ? "desbloqueios" : "bloqueios") }); },
  });
  pEv.corpo.appendChild(L.graf.legenda([{ rot: "Bloqueado (manual + por avaria)", cor: cB }, { rot: "Desbloqueado (manual + baixa de avaria)", cor: cD }]));
  raiz.appendChild(L.grade(pEv));

  // ---------------- motivos e departamentos (do que entrou)
  var idxEntrou = L.filtrarEv(L.spec({ f: { rotina: [0], tipo: [1, 2] } }, c.p));
  var pMot = L.painel({ titulo: "Por que bloqueou", sub: "motivo dos bloqueios · " + M.nome.toLowerCase(), classe: "c-6" });
  L.barrasDim(pMot.corpo, idxEntrou, "motivo", 8, med);
  var pDep = L.painel({ titulo: "O que foi bloqueado", sub: "departamento dos bloqueios · " + M.nome.toLowerCase(), classe: "c-6" });
  L.barrasDim(pDep.corpo, idxEntrou, "depto", 8, med);
  raiz.appendChild(L.grade(pMot, pDep));

  // ---------------- quem bloqueia
  var EV = L.EV, porFun = new Map();
  for (var j = 0; j < c.idx.length; j++) {
    var i = c.idx[j], u = EV.u[i] < 0 ? 0 : L.D.funcs[EV.u[i]][0], x = porFun.get(u), k = EV.k[i];
    if (!x) { x = { k: u, nb: 0, vb: 0, nd: 0, vd: 0, va: 0, ult: 0 }; porFun.set(u, x); }
    if (k === 1 || k === 2) { x.nb++; x.vb += EV.v[i]; } else if (k === 4 || k === 5) { x.nd++; x.vd += EV.v[i]; }
    if (k === 2 || k === 3) x.va += EV.va[i];
    if (EV.t[i] > x.ult) x.ult = EV.t[i];
  }
  var funs = Array.from(porFun.values());
  var tFun = L.tabela({
    titulo: "Quem bloqueia e desbloqueia", arquivo: "266-por-funcionario", aba: "Funcionários", rank: true, porPagina: 10, linhas: funs, ordem: { id: "vb", desc: true }, livre: true,
    buscaTexto: function (x) { return x.k + " " + L.nomeDe("func", x.k); },
    colunas: [
      { id: "nome", titulo: "Funcionário", tipo: "texto", valor: function (x) { return L.nomeDe("func", x.k); } },
      { id: "nb", titulo: "Bloqueios", tipo: "inteiro", valor: function (x) { return x.nb; } },
      { id: "vb", titulo: "R$ bloqueado", tipo: "moedaInt", valor: function (x) { return x.vb; }, barra: true, exportarTipo: "moeda" },
      { id: "nd", titulo: "Desbloqueios", tipo: "inteiro", valor: function (x) { return x.nd; } },
      { id: "vd", titulo: "R$ desbloqueado", tipo: "moedaInt", valor: function (x) { return x.vd; }, exportarTipo: "moeda" },
      { id: "va", titulo: "Avaria registrada", tipo: "moedaInt", valor: function (x) { return x.va; }, exportarTipo: "moeda" },
      { id: "ult", titulo: "Último movimento", tipo: "texto", valor: function (x) { return x.ult; }, fmt: function (v) { return L.fT(v); }, exp: function (x) { return L.fT(x.ult); } },
    ],
    aoClicar: function (x, ev) { L.clique("func", x.k, ev, { f: { rotina: [0] } }); },
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Quem bloqueia e desbloqueia", sub: "na rotina 266 · clique para abrir o relatório da pessoa", classe: "c-12", semPad: true, corpo: tFun })));

  // ---------------- produtos
  var gp = L.agruparEv(c.idx, "produto"), hojePorProd = L.bloqueadoHojePorProduto();
  gp.forEach(function (x) { x.hoje = hojePorProd.get(L.P.i.get(x.k)) || 0; });
  var tProd = L.tabela({
    titulo: "Produtos bloqueados na 266", arquivo: "266-por-produto", aba: "Produtos", rank: true, porPagina: 25, linhas: gp, ordem: { id: "ve", desc: true },
    foto: function (x) { return L.P.i.get(x.k); }, buscaTexto: function (x) { return x.k + " " + L.nomeDe("produto", x.k) + " " + L.nomeDe("fornecedor", L.DIM.fornecedor.deProd(L.P.i.get(x.k))); },
    colunas: [
      { id: "nome", titulo: "Produto", tipo: "texto", valor: function (x) { return L.nomeDe("produto", x.k); } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (x) { return x.k; }, fmt: function (v) { return String(v); }, somar: false, essencial: false },
      { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (x) { return L.nomeDe("fornecedor", L.DIM.fornecedor.deProd(L.P.i.get(x.k))); }, essencial: false },
      { id: "n", titulo: "Mov.", tipo: "inteiro", valor: function (x) { return x.n; } },
      { id: "ve", titulo: "Bloqueado", tipo: "moedaInt", valor: function (x) { return x.ve; }, barra: true, exportarTipo: "moeda" },
      { id: "vs", titulo: "Desbloqueado", tipo: "moedaInt", valor: function (x) { return x.vs; }, exportarTipo: "moeda" },
      { id: "va", titulo: "Avaria", tipo: "moedaInt", valor: function (x) { return x.va; }, exportarTipo: "moeda" },
      { id: "saldo", titulo: "Bloq. − desbloq.", tipo: "moedaInt", valor: function (x) { return x.ve - x.vs; }, exportarTipo: "moeda", essencial: false, dica: "No livro: o bloqueio automático do recebimento não aparece, só a liberação" },
      { id: "hoje", titulo: "Bloqueado hoje", tipo: "moedaInt", valor: function (x) { return x.hoje; }, exportarTipo: "moeda", essencial: false },
    ],
    aoClicar: function (x, ev) { L.clique("produto", x.k, ev); },
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Produtos", sub: "o que mais foi bloqueado na 266 no período · valor ao custo de hoje", classe: "c-12", semPad: true, corpo: tProd })));
  raiz.appendChild(L.nota("A 266 grava o bloqueio e o desbloqueio de dois jeitos (com e sem versão no nome do programa); os dois são lidos aqui, um a um, e o saldo fecha com o estoque bloqueado do PCEST. O desbloqueio inclui a liberação de mercadoria recebida (motivo “Conferido pelo recebimento”), cujo bloqueio na entrada é automático e não fica no livro — por isso o desbloqueado passa do bloqueado. Avaria = quantidade bloqueada como indenizada (QTINDENIZ)."));
}

})();
