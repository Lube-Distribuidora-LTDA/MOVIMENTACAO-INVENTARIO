/* =============================================================================
 * pag-visao.js — VISÃO GERAL: o que está acontecendo no galpão.
 * Movimento do estoque bloqueado (recebimento 1301, 266, WMS, devoluções) + inventário rotativo
 * (1147) + o bloqueado de hoje, com comparação ao período anterior e ao ano anterior.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "visao", grupo: "Galpão", menu: "Visão geral", icone: "home",
  titulo: "Movimentação de Inventário", olho: "O que está acontecendo no galpão",
  filtros: ["filial", "tipo", "motivo", "func", "depto", "fornecedor", "produto"],
  mais: ["rotina", "sentido", "secao", "dow", "hora"],
  render: render,
});

function render(raiz) {
  var c = L.ctxEv(), r = c.res, EV = L.EV, med = L.medida(), M = L.MEDIDAS[med];
  var aviso = L.avisoSuspeitos(c.idx); if (aviso) raiz.appendChild(aviso);

  // posição de hoje (filial e produto da tela) e inventário do período
  var es = L.resumoEs(L.filtrarEs(L.spec())), ci = L.ctxIv(), ri = ci.res;

  raiz.appendChild(L.kpis(
    L.kpi({ icone: "pulso", rot: "Movimentos no bloqueado", valor: r.n, fmt: L.fInt, classe: "heroi", cmp: c.kc("n"),
            leg: L.h("span", { text: L.fInt(r.skus) + " SKUs · " + L.fRc(r.ve + r.vs + r.vn) + " movimentados" }), ajuda: "Tudo o que entrou, saiu ou mudou no estoque bloqueado no período",
            aoClicar: function () { L.irPara("detalhe"); } }),
    L.kpi({ icone: "cadeado", rot: "Entrou no bloqueado", valor: r.ve, fmt: L.fRk, fmtTitulo: L.fR, cmp: c.kc("ve", true), classe: r.ve ? "" : "zero",
            leg: L.h("span", { text: L.fQ(r.qe) + " un. · recebimento, devoluções e bloqueios" }), aoClicar: function () { L.abrirDossie({ titulo: "Entrou no bloqueado", f: { sentido: [1] } }); } }),
    L.kpi({ icone: "destravar", rot: "Saiu do bloqueado", valor: r.vs, fmt: L.fRk, fmtTitulo: L.fR, cmp: c.kc("vs"), classe: r.vs ? "ok" : "zero",
            leg: L.h("span", { text: L.fQ(r.qs) + " un. · liberação do WMS e desbloqueios" }), aoClicar: function () { L.abrirDossie({ titulo: "Saiu do bloqueado", f: { sentido: [-1] } }); } }),
    L.kpi({ icone: "alerta", rot: "Avaria registrada", valor: r.va266, fmt: L.fRk, fmtTitulo: L.fR, cmp: c.kc("va266", true), classe: r.va266 ? "perigo" : "zero",
            leg: L.h("span", { text: L.fQ(r.qa266) + " un. marcadas como avaria na 266" }), aoClicar: function () { L.abrirDossie({ titulo: "Avaria registrada", f: { tipo: [2, 3] } }); } }),
    L.kpi({ icone: "armazem", rot: "Bloqueado hoje", valor: es.vb, fmt: L.fRk, fmtTitulo: L.fR, classe: es.vb ? "atencao" : "zero",
            leg: L.h("span", { text: L.fRc(es.va) + " em avaria · " + L.fInt(es.skus) + " SKUs" }), ajuda: "Posição atual do estoque bloqueado (não depende do período)", aoClicar: function () { L.irPara("posicao"); } }),
    L.kpi({ icone: "prancheta", rot: "Acurácia do inventário", valor: ri.acuracia, fmt: function (v) { return L.fPct(v, 1); }, cmp: ci.kc("acuracia", false, true), classe: ri.n ? (ri.acuracia >= 0.9 ? "ok" : "violeta") : "zero",
            leg: L.h("span", { text: ri.n ? L.fInt(ri.n) + " contagens · ajuste " + (ri.liq >= 0 ? "+" : "") + L.fRc(ri.liq) : "nenhum inventário no período" }), aoClicar: function () { L.irPara("inventario"); } })));

  // ---------------- movimento por dia/mês
  var s = L.serieEv(c.idx, c.p), gran = s.gran;
  var pMov = L.painel({ titulo: "Movimento do bloqueado por " + (gran === "dia" ? "dia" : "mês"), sub: "entrou × saiu × neutro · " + M.nome.toLowerCase() + " · clique numa coluna para abrir o " + (gran === "dia" ? "dia" : "mês"), classe: "c-8", acoes: [L.segMedida()] });
  var g1 = L.h("div"); pMov.corpo.appendChild(g1);
  var C = L.cores(), corE = L.cssVar("--d5"), corS = L.cssVar("--d4"), corN = L.cssVar("--d8");
  var pega = function (suf) { return Array.from(med === "n" ? s["n" + suf] : med === "q" ? s["q" + suf] : s["v" + suf]); };
  L.graf.colunas(g1, {
    categorias: s.rot, modo: "empilhado", altura: 300, tipo: M.tipo, fmt: M.fmt, rotulos: s.chaves.length <= 14,
    series: [{ nome: "Entrou no bloqueado", cor: corE, valores: pega("e") }, { nome: "Saiu do bloqueado", cor: corS, valores: pega("s") }, { nome: "Neutro", cor: corN, valores: pega("n") }],
    dica: function (i) {
      var k = s.chaves[i];
      return { titulo: gran === "dia" ? L.nomeDe("dia", k) : L.fMesKLongo(k), linhas: [
        { rot: "Entrou no bloqueado", cor: corE, val: L.fR(s.ve[i]) + " · " + L.fInt(s.ne[i]) + " mov." },
        { rot: "Saiu do bloqueado", cor: corS, val: L.fR(s.vs[i]) + " · " + L.fInt(s.ns[i]) + " mov." },
        { rot: "Neutro", cor: corN, val: L.fR(s.vn[i]) + " · " + L.fInt(s.nn[i]) + " mov." },
        { rot: "Saldo do bloqueado", val: (s.ve[i] - s.vs[i] >= 0 ? "+" : "") + L.fR(s.ve[i] - s.vs[i]) }] };
    },
    aoClicar: function (i, si, ev) { var k = s.chaves[i], extra = si === 0 ? { sentido: [1] } : si === 1 ? { sentido: [-1] } : si === 2 ? { sentido: [0] } : {};
      L.abrirDossie({ dim: gran, id: k, f: extra, titulo: (gran === "dia" ? L.nomeDe("dia", k) : L.fMesKLongo(k)) + (si != null ? " · " + ["Entrou no bloqueado", "Saiu do bloqueado", "Neutro"][si] : "") }); },
  });
  pMov.corpo.appendChild(L.graf.legenda([{ rot: "Entrou no bloqueado", cor: corE }, { rot: "Saiu do bloqueado", cor: corS }, { rot: "Neutro (não muda o saldo)", cor: corN }]));

  // ---------------- composição por tipo
  var pTipo = L.painel({ titulo: "Por tipo de movimento", sub: M.nome.toLowerCase() + " · clique para abrir", classe: "c-4" });
  var fat = [];
  L.TIPOS.forEach(function (t) { var v = med === "n" ? r.nTipo[t.id] : med === "q" ? r.qTipo[t.id] : r.porTipo[t.id]; if (v > 0) fat.push({ id: t.id, rot: t.nome, valor: v, cor: L.corTipo(t.id) }); });
  fat.sort(function (a, b) { return b.valor - a.valor; });
  fat.forEach(function (f, i) { f.idxOriginal = i; });
  var g2 = L.h("div"); pTipo.corpo.appendChild(g2);
  L.graf.rosca(g2, { fatias: fat, fmt: M.fmt, altura: 230, centro: { valor: M.fmt(fat.reduce(function (a, f) { return a + f.valor; }, 0)), titulo: M.nome },
    dica: function (i) { var f = fat[i], t = f.id; return { titulo: f.rot, linhas: [{ rot: "Movimentos", val: L.fInt(r.nTipo[t]) }, { rot: "Unidades", val: L.fQ(r.qTipo[t]) }, { rot: "Valor", val: L.fR(r.porTipo[t]) }, { rot: "Rotina", val: L.ROTINAS[L.TIPOS[t].g].nome }] }; },
    aoClicar: function (i, s2, ev) { L.clique("tipo", fat[i].id, ev); } });
  pTipo.corpo.appendChild(L.graf.legendaLista(fat, M.fmt, function (i, ev) { L.clique("tipo", fat[i].id, ev); }));

  raiz.appendChild(L.grade(pMov, pTipo));

  // ---------------- quando o galpão se movimenta (dia da semana × hora)
  var pCal = L.painel({ titulo: "Quando o galpão se movimenta", sub: "movimentos por dia da semana e hora · clique numa célula para abrir", classe: "c-6" });
  var mat = [], horas = [], dows = [1, 2, 3, 4, 5, 6, 0];
  for (var d = 0; d < 7; d++) { mat.push(new Float64Array(24)); }
  for (var j = 0; j < c.idx.length; j++) { var i = c.idx[j]; mat[(EV.dia[i] + L.BASE_DOW) % 7][Math.floor((EV.t[i] % 1440) / 60)]++; }
  var hmin = 23, hmax = 0;
  mat.forEach(function (lin) { for (var h = 0; h < 24; h++) if (lin[h]) { if (h < hmin) hmin = h; if (h > hmax) hmax = h; } });
  if (hmin > hmax) { hmin = 6; hmax = 18; }
  for (var h2 = hmin; h2 <= hmax; h2++) horas.push(h2);
  var boxCal = L.h("div"); pCal.corpo.appendChild(boxCal);
  L.graf.calor(boxCal, {
    colunas: horas.map(function (h) { return (h < 10 ? "0" : "") + h + "h"; }),
    linhas: dows.map(function (dw) { return { rot: L.DS3[dw], valores: horas.map(function (h) { return mat[dw][h] || null; }) }; }),
    fmt: function (v) { return L.fAbrev(v, false); },
    dica: function (li, ci) { var dw = dows[li], h = horas[ci]; return { titulo: L.DIAS_SEMANA[dw] + ", " + h + "h às " + (h + 1) + "h", linhas: [{ rot: "Movimentos", val: L.fInt(mat[dw][h]) }], clique: "Clique para abrir esses movimentos" }; },
    aoClicar: function (li, ci) { var dw = dows[li], h = horas[ci]; L.abrirDossie({ titulo: L.DIAS_SEMANA[dw] + ", das " + h + "h às " + (h + 1) + "h", f: { dow: [dw], hora: [h] } }); },
  });

  // ---------------- motivos
  var pMot = L.painel({ titulo: "Principais motivos", sub: M.nome.toLowerCase() + " · clique para abrir · Ctrl+clique filtra", classe: "c-6" });
  barrasDim(pMot.corpo, c.idx, "motivo", 8, med);
  raiz.appendChild(L.grade(pCal, pMot));

  // ---------------- quem movimenta + produtos
  var pFun = L.painel({ titulo: "Quem movimenta", sub: "movimentos por funcionário · PCADMIN é o sistema (WMS)", classe: "c-6" });
  barrasDim(pFun.corpo, c.idx, "func", 8, "n");
  var pDep = L.painel({ titulo: "Departamentos", sub: M.nome.toLowerCase() + " · clique para abrir", classe: "c-6" });
  barrasDim(pDep.corpo, c.idx, "depto", 8, med);
  raiz.appendChild(L.grade(pFun, pDep));

  // ---------------- produtos e últimos movimentos
  var grupos = L.agruparEv(c.idx, "produto");
  var tab = L.tabela({
    titulo: "Produtos mais movimentados", arquivo: "produtos-movimentados", aba: "Produtos", rank: true, porPagina: 10, livre: true,
    linhas: grupos, ordem: { id: "v", desc: true }, foto: function (g) { return L.P.i.get(g.k); }, buscaTexto: function (g) { return g.k + " " + L.nomeDe("produto", g.k); },
    colunas: [
      { id: "nome", titulo: "Produto", tipo: "texto", valor: function (g) { return L.nomeDe("produto", g.k); } },
      { id: "n", titulo: "Mov.", tipo: "inteiro", valor: function (g) { return g.n; } },
      { id: "v", titulo: "Movimentado", tipo: "moedaInt", valor: function (g) { return g.v; }, barra: true, exportarTipo: "moeda" },
      { id: "ve", titulo: "Entrou", tipo: "moedaInt", valor: function (g) { return g.ve; }, exportarTipo: "moeda", essencial: false },
      { id: "vs", titulo: "Saiu", tipo: "moedaInt", valor: function (g) { return g.vs; }, exportarTipo: "moeda", essencial: false },
    ],
    aoClicar: function (g, ev) { L.clique("produto", g.k, ev); },
  });
  var pProd = L.painel({ titulo: "Produtos mais movimentados", sub: "valor ao custo de hoje · clique para abrir o relatório do produto", classe: "c-6", semPad: true, corpo: tab });
  var pFeed = L.painel({ titulo: "Últimos movimentos", sub: "o mais recente primeiro · dados até " + L.fDataHora(L.META.ult_mov), classe: "c-6", corpo: L.feedMov(c.idx, 14),
    acoes: [L.btnPainel("tabela", "Ver todos", function () { L.irPara("detalhe"); })] });
  raiz.appendChild(L.grade(pProd, pFeed));
  raiz.appendChild(L.nota("Valor = quantidade × custo financeiro de HOJE (o livro de bloqueio do WinThor não guarda custo). O inventário usa o valor que a própria 1147 lançou. Comparações: o período imediatamente anterior, do mesmo tamanho, e as mesmas datas do ano anterior, com os mesmos filtros."));
}

/* barras de ranking de uma dimensão (top n), clicáveis */
function barrasDim(corpo, idx, dim, n, med) {
  var gr = L.agruparEv(idx, dim, { ordem: function (a, b) { return L.valorMedida(b, "", med) - L.valorMedida(a, "", med); } });
  var tot = gr.reduce(function (s, g) { return s + L.valorMedida(g, "", med); }, 0), top = gr.slice(0, n), M = L.MEDIDAS[med];
  var box = L.h("div"); corpo.appendChild(box);
  L.graf.barras(box, {
    itens: top.map(function (g) { return { rot: L.nomeDe(dim, g.k), valor: L.valorMedida(g, "", med) }; }), total: tot, fmt: M.fmt, linhaH: 28,
    cor: function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
    dica: function (i) { var g = top[i]; return { titulo: L.nomeDe(dim, g.k), linhas: [{ rot: "Movimentos", val: L.fInt(g.n) }, { rot: "Entrou no bloqueado", val: L.fR(g.ve) }, { rot: "Saiu do bloqueado", val: L.fR(g.vs) }, { rot: "Participação", val: L.fPct(tot ? L.valorMedida(g, "", med) / tot : 0, 1) }] }; },
    aoClicar: function (i, s, ev) { L.clique(dim, top[i].k, ev); },
  });
  if (gr.length > n) corpo.appendChild(L.h("div", { class: "mais-itens" }, L.h("button", { class: "mini-btn", type: "button", text: "Ver os " + L.fInt(gr.length), onclick: function () { L.irPara("analise", { fonte: "ev", linhas: dim }); } })));
}
L.barrasDim = barrasDim;

})();
