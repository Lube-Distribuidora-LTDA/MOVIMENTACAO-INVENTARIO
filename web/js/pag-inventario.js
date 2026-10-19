/* =============================================================================
 * pag-inventario.js — ROTINA 1147: inventário rotativo.
 * O que foi contado, quanto bateu com o estoque (acurácia), o que sobrou e o que
 * faltou (valor que a própria 1147 lançou no estoque, EI/SI), quem contou e quais
 * produtos divergem sempre.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "inventario", grupo: "Rotina 1147", menu: "Inventário rotativo", icone: "prancheta",
  titulo: "Inventário rotativo", olho: "Rotina 1147 · Manutenção de inventário rotativo",
  filtros: ["filial", "func", "resultado", "depto", "fornecedor", "produto"],
  mais: ["secao", "funcAtu", "inventario", "dow"],
  render: render,
});

function render(raiz) {
  var c = L.ctxIv(), r = c.res, IV = L.IV, P = L.P, p = c.p;
  if (!r.n) {
    raiz.appendChild(L.h("div", { class: "vazio grande", html: "<b>Nenhum inventário rotativo no período</b>O último inventário atualizado foi em " + L.esc(L.fDataHora(L.META.ult_inv)) + ". Escolha um período maior (Ano atual, 12 meses ou Tudo)." }));
    raiz.appendChild(L.h("div", { style: { textAlign: "center" } }, L.h("button", { class: "btn pri", type: "button", text: "Ver os últimos 12 meses", onclick: function () { L.setPeriodo({ r: "m12" }); } })));
    return;
  }
  var fP = function (v) { return L.fPct(v, 1); };
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "alvo", rot: "Acurácia", valor: r.acuracia, fmt: fP, classe: "heroi", cmp: c.kc("acuracia", false, true),
            leg: L.h("span", { text: L.fInt(r.iguais) + " de " + L.fInt(r.n) + " contagens bateram com o estoque" }), ajuda: "Contagens sem nenhuma diferença ÷ contagens" }),
    L.kpi({ icone: "prancheta", rot: "Inventários", valor: r.inv, fmt: L.fInt, cmp: c.kc("inv"), leg: L.h("span", { text: L.fInt(r.n) + " contagens · " + L.fInt(r.skus) + " SKUs" + (r.abertos ? " · " + r.abertos + " em contagem" : "") }) }),
    L.kpi({ icone: "setaCima", rot: "Sobra (EI)", valor: r.vsobra, fmt: L.fRk, fmtTitulo: L.fR, classe: r.vsobra ? "" : "zero", cmp: c.kc("vsobra", true),
            leg: L.h("span", { text: L.fInt(r.sobra) + " produtos · " + L.fQ(r.qsobra) + " un. a mais" }), aoClicar: function () { L.abrirDossie({ fonte: "iv", titulo: "Sobras do inventário", f: { resultado: [1] } }); } }),
    L.kpi({ icone: "setaBaixo", rot: "Falta (SI)", valor: r.vfalta, fmt: L.fRk, fmtTitulo: L.fR, classe: r.vfalta ? "perigo" : "zero", cmp: c.kc("vfalta", true),
            leg: L.h("span", { text: L.fInt(r.falta) + " produtos · " + L.fQ(r.qfalta) + " un. a menos" }), aoClicar: function () { L.abrirDossie({ fonte: "iv", titulo: "Faltas do inventário", f: { resultado: [-1] } }); } }),
    L.kpi({ icone: "ordem", rot: "Ajuste líquido", valor: r.liq, fmt: function (v) { return (v > 0 ? "+" : "") + L.fRk(v); }, fmtTitulo: L.fR, classe: r.liq < 0 ? "perigo" : "ok", cmp: c.kc("liq"),
            leg: L.h("span", { text: "sobra − falta lançada no estoque" }) }),
    L.kpi({ icone: "percent", rot: "Divergência", valor: r.pctDiv, fmt: fP, classe: r.pctDiv > 0.05 ? "atencao" : "", cmp: c.kc("pctDiv", true, true),
            leg: L.h("span", { text: L.fRc(r.abs) + " de " + L.fRc(r.vsis) + " contados (sobra + falta)" }), ajuda: "(sobra + falta) ÷ valor do estoque contado" })));

  // ---------------- sobra × falta por dia/mês e acurácia
  var gran = L.granularidade(p), chaves = [], pos = new Map();
  if (gran === "dia") for (var d = p.de; d <= p.ate; d++) { pos.set(d, chaves.length); chaves.push(d); }
  else { var k = L.mesDeDia(p.de), fim = L.mesDeDia(p.ate); while (k <= fim) { pos.set(k, chaves.length); chaves.push(k); k = k % 100 === 12 ? k + 89 : k + 1; } }
  var n = chaves.length, vs = new Float64Array(n), vf = new Float64Array(n), cont = new Float64Array(n), ig = new Float64Array(n), invs = chaves.map(function () { return new Set(); });
  for (var j = 0; j < c.idx.length; j++) {
    var i = c.idx[j], x = pos.get(gran === "dia" ? IV.dia[i] : L.mesDeDia(IV.dia[i])); if (x == null) continue;
    cont[x]++; invs[x].add(IV.i[i]);
    if (IV.dif[i] > 0.0005) vs[x] += IV.vdif[i]; else if (IV.dif[i] < -0.0005) vf[x] += -IV.vdif[i]; else ig[x]++;
  }
  // dias sem contagem saem do gráfico diário (senão vira um pente de zeros)
  var vis = []; for (var q = 0; q < n; q++) if (gran === "mes" || cont[q]) vis.push(q);
  var rot = vis.map(function (q) { return gran === "dia" ? L.fDiaCurto(chaves[q]) : L.fMesK(chaves[q]); });
  var cS = L.cssVar("--d1"), cF = L.cssVar("--d5");
  var pSF = L.painel({ titulo: "Sobra × falta por " + (gran === "dia" ? "dia com contagem" : "mês"), sub: "valor lançado pela 1147 · clique para abrir", classe: "c-8" });
  var g1 = L.h("div"); pSF.corpo.appendChild(g1);
  L.graf.colunas(g1, { categorias: rot, altura: 280, tipo: "moeda", fmt: L.fRc, rotulos: vis.length <= 16,
    series: [{ nome: "Sobra", cor: cS, valores: vis.map(function (q) { return vs[q]; }) }, { nome: "Falta", cor: cF, valores: vis.map(function (q) { return vf[q]; }) }],
    dica: function (a) { var q = vis[a], kk = chaves[q]; return { titulo: gran === "dia" ? L.nomeDe("dia", kk) : L.fMesKLongo(kk), linhas: [
      { rot: "Sobra", cor: cS, val: L.fR(vs[q]) }, { rot: "Falta", cor: cF, val: L.fR(vf[q]) }, { rot: "Líquido", val: (vs[q] - vf[q] >= 0 ? "+" : "") + L.fR(vs[q] - vf[q]) },
      { rot: "Inventários", val: L.fInt(invs[q].size) }, { rot: "Contagens", val: L.fInt(cont[q]) }, { rot: "Acurácia", val: L.fPct(cont[q] ? ig[q] / cont[q] : null, 1) }] }; },
    aoClicar: function (a, si) { var kk = chaves[vis[a]]; L.abrirDossie({ fonte: "iv", dim: gran, id: kk, f: si === 0 ? { resultado: [1] } : si === 1 ? { resultado: [-1] } : {}, titulo: (gran === "dia" ? L.nomeDe("dia", kk) : L.fMesKLongo(kk)) + " · inventário" }); } });
  pSF.corpo.appendChild(L.graf.legenda([{ rot: "Sobra (EI, contou mais que o estoque)", cor: cS }, { rot: "Falta (SI, contou menos)", cor: cF }]));

  var pAc = L.painel({ titulo: "Acurácia por " + (gran === "dia" ? "dia" : "mês"), sub: "contagens sem diferença ÷ contagens", classe: "c-4" });
  var g2 = L.h("div"); pAc.corpo.appendChild(g2);
  var ac = vis.map(function (q) { return cont[q] ? ig[q] / cont[q] * 100 : null; });
  L.graf.linhas(g2, { categorias: rot, altura: 280, series: [{ nome: "Acurácia", cor: L.cores().ouro, destaque: true, area: true, valores: ac }], fEixo: function (v) { return L.fNum(v, 0) + "%"; },
    fmt: function (v) { return L.fNum(v, 0) + "%"; }, rotulos: vis.length <= 14 ? true : "destaque", rotuloMin: 0,
    ref: [{ valor: r.acuracia * 100, rot: "média " + L.fPct(r.acuracia, 1) }],
    dica: function (a) { var q = vis[a]; return { titulo: gran === "dia" ? L.nomeDe("dia", chaves[q]) : L.fMesKLongo(chaves[q]), linhas: [{ rot: "Acurácia", val: L.fPct(cont[q] ? ig[q] / cont[q] : null, 1) }, { rot: "Contagens", val: L.fInt(cont[q]) }, { rot: "Sem diferença", val: L.fInt(ig[q]) }] }; } });
  raiz.appendChild(L.grade(pSF, pAc));

  // ---------------- departamentos e quem contou
  var gd = L.agruparIv(c.idx, "depto");
  var pDep = L.painel({ titulo: "Onde diverge", sub: "sobra + falta por departamento · clique para abrir", classe: "c-6" });
  var g3 = L.h("div"); pDep.corpo.appendChild(g3);
  var topD = gd.slice(0, 8), totAbs = gd.reduce(function (s, g) { return s + g.abs; }, 0);
  L.graf.barras(g3, { itens: topD.map(function (g) { return { rot: L.nomeDe("depto", g.k), valor: g.abs }; }), total: totAbs, fmt: L.fRc, linhaH: 28,
    cor: function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
    dica: function (i) { var g = topD[i]; return { titulo: L.nomeDe("depto", g.k), linhas: [{ rot: "Sobra", cor: cS, val: L.fR(g.vsobra) }, { rot: "Falta", cor: cF, val: L.fR(g.vfalta) }, { rot: "Contagens", val: L.fInt(g.n) }, { rot: "Acurácia", val: L.fPct(g.acuracia, 1) }] }; },
    aoClicar: function (i, s, ev) { L.clique("depto", topD[i].k, ev, { fonte: "iv" }); } });

  var gf = L.agruparIv(c.idx, "func", { ordem: "n" });
  var tFun = L.tabela({ titulo: "Quem contou", arquivo: "inventario-por-contador", aba: "Quem contou", porPagina: 10, linhas: gf, ordem: { id: "n", desc: true }, livre: true,
    colunas: [
      { id: "nome", titulo: "Contou", tipo: "texto", valor: function (g) { return L.nomeDe("func", g.k); } },
      { id: "inv", titulo: "Inventários", tipo: "inteiro", valor: function (g) { return g.ninv; } },
      { id: "n", titulo: "Contagens", tipo: "inteiro", valor: function (g) { return g.n; } },
      { id: "ac", titulo: "Acurácia", tipo: "pct", valor: function (g) { return g.acuracia; } },
      { id: "abs", titulo: "Divergência", tipo: "moedaInt", valor: function (g) { return g.abs; }, barra: true, exportarTipo: "moeda" },
      { id: "liq", titulo: "Líquido", tipo: "moedaInt", valor: function (g) { return g.liq; }, classe: function (v) { return v < 0 ? "neg" : v > 0 ? "pos" : ""; }, exportarTipo: "moeda", essencial: false },
    ],
    aoClicar: function (g, ev) { L.clique("func", g.k, ev, { fonte: "iv" }); } });
  raiz.appendChild(L.grade(pDep, L.painel({ titulo: "Quem contou", sub: "acurácia e divergência das contagens de cada pessoa", classe: "c-6", semPad: true, corpo: tFun })));

  // ---------------- inventários
  var gi = L.agruparIv(c.idx, "inventario", { ordem: function (a, b) { return b.ultDia - a.ultDia || b.k - a.k; } });
  var tInv = L.tabela({ titulo: "Inventários do período", arquivo: "inventarios-rotativos", aba: "Inventários", porPagina: 10, linhas: gi, ordem: { id: "num", desc: true },
    buscaTexto: function (g) { return g.k + " " + L.nomeDe("func", g.uc < 0 ? 0 : L.D.funcs[g.uc][0]); },
    colunas: [
      { id: "num", titulo: "Nº", tipo: "inteiro", valor: function (g) { return g.k; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "dia", titulo: "Data", tipo: "texto", valor: function (g) { return g.dia; }, fmt: function (v) { return L.fDia(v); }, exp: function (g) { return L.fDia(g.dia); } },
      { id: "fil", titulo: "Filial", tipo: "inteiro", valor: function (g) { return g.f; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "fun", titulo: "Contou", tipo: "texto", valor: function (g) { return g.uc < 0 ? "" : L.nomeDe("func", L.D.funcs[g.uc][0]); } },
      { id: "n", titulo: "Produtos", tipo: "inteiro", valor: function (g) { return g.n; } },
      { id: "ac", titulo: "Acurácia", tipo: "pct", valor: function (g) { return g.acuracia; } },
      { id: "vs", titulo: "Sobra", tipo: "moedaInt", valor: function (g) { return g.vsobra; }, exportarTipo: "moeda" },
      { id: "vf", titulo: "Falta", tipo: "moedaInt", valor: function (g) { return g.vfalta; }, exportarTipo: "moeda" },
      { id: "liq", titulo: "Líquido", tipo: "moedaInt", valor: function (g) { return g.liq; }, classe: function (v) { return v < 0 ? "neg" : v > 0 ? "pos" : ""; }, exportarTipo: "moeda" },
    ],
    aoClicar: function (g) { L.abrirDossie({ fonte: "iv", dim: "inventario", id: g.k, periodoLivre: true }); } });

  // ---------------- produtos que divergem
  var gp = L.agruparIv(c.idx, "produto", { ordem: "abs" }).filter(function (g) { return g.div > 0; });
  var tProd = L.tabela({ titulo: "Produtos com divergência", arquivo: "inventario-produtos-divergentes", aba: "Produtos", rank: true, porPagina: 10, linhas: gp, ordem: { id: "abs", desc: true },
    foto: function (g) { return P.i.get(g.k); }, buscaTexto: function (g) { return g.k + " " + L.nomeDe("produto", g.k); },
    colunas: [
      { id: "nome", titulo: "Produto", tipo: "texto", valor: function (g) { return L.nomeDe("produto", g.k); } },
      { id: "n", titulo: "Contado", tipo: "inteiro", valor: function (g) { return g.n; }, fmt: function (v) { return v + "×"; } },
      { id: "div", titulo: "Com diferença", tipo: "inteiro", valor: function (g) { return g.div; }, fmt: function (v, g) { return { html: v + "×" + (g.n > 1 && g.div === g.n ? " " + L.tag("sempre", "perigo") : "") }; } },
      { id: "qs", titulo: "Sobra (un.)", tipo: "num", valor: function (g) { return g.qsobra || null; }, fmt: function (v) { return v ? L.fQ(v) : ""; }, exportarTipo: "inteiro", essencial: false },
      { id: "qf", titulo: "Falta (un.)", tipo: "num", valor: function (g) { return g.qfalta || null; }, fmt: function (v) { return v ? L.fQ(v) : ""; }, exportarTipo: "inteiro", essencial: false },
      { id: "abs", titulo: "Divergência", tipo: "moedaInt", valor: function (g) { return g.abs; }, barra: true, exportarTipo: "moeda" },
      { id: "liq", titulo: "Líquido", tipo: "moedaInt", valor: function (g) { return g.liq; }, classe: function (v) { return v < 0 ? "neg" : v > 0 ? "pos" : ""; }, exportarTipo: "moeda" },
    ],
    aoClicar: function (g, ev) { L.clique("produto", g.k, ev, { aba: "inventario" }); } });
  raiz.appendChild(L.grade(
    L.painel({ titulo: "Inventários do período", sub: "clique para ver produto a produto", classe: "c-6", semPad: true, corpo: tInv }),
    L.painel({ titulo: "Produtos que mais divergem", sub: "\"sempre\" = deu diferença em todas as contagens do período", classe: "c-6", semPad: true, corpo: tProd })));
  raiz.appendChild(L.nota("Conferido: a diferença de cada produto bate, mês a mês, com os EI/SI que a 1147 lançou no PCMOV (quantidade e valor), desde jan/2025 — a carga refaz essa conferência sempre. Valor = o que a própria 1147 lançou (custo financeiro do dia da atualização)."));
}

})();
