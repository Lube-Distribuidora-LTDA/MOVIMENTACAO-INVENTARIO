/* =============================================================================
 * dossie.js — o RELATÓRIO PERSONALIZADO que abre a cada clique.
 *
 * Qualquer barra, ponto, fatia, cartão, célula ou linha do painel abre aqui o
 * relatório daquele recorte, já com os filtros e o período da tela. Dentro dele,
 * clicar abre o relatório do item clicado (com "Voltar"). Abas conforme a base:
 *   movimentos (ev): Resumo · Movimentos · (produto: Inventário · Posição hoje)
 *   inventário (iv): Resumo · Contagens · (produto: Movimentos)
 *   bloqueado hoje (es): Resumo · Movimentos
 * ent = { dim, id, fonte, f: filtros extras, titulo, periodoLivre, aba, suspeitos }
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var pilha = [], aba = "resumo";

/* ------------------------------ escopo ------------------------------ */
function escopo(ent) {
  var f = JSON.parse(JSON.stringify(L.estado.filtros));
  if (ent.f) for (var k in ent.f) { if (ent.f[k] == null) delete f[k]; else f[k] = ent.f[k].slice(); }
  if (ent.dim && ent.dim !== "dia" && ent.dim !== "mes") f[ent.dim] = [ent.id];
  var p = L.periodo();
  if (ent.dim === "dia") p = { de: +ent.id, ate: +ent.id, dias: 1, r: "livre", rot: L.nomeDe("dia", ent.id) };
  else if (ent.dim === "mes") { var y = Math.floor(ent.id / 100), m = ent.id % 100, de = L.diaDeIso(y + "-" + (m < 10 ? "0" : "") + m + "-01"); p = { de: de, ate: Math.min(L.ultimoDoMes(de), L.hojeDia()), r: "livre", rot: L.fMesKLongo(ent.id) }; p.dias = p.ate - p.de + 1; }
  else if (ent.periodoLivre) { var ini = Math.min(L.EV.diaMin, L.IV.diaMin || L.EV.diaMin); p = { de: ini, ate: L.hojeDia(), r: "tudo", rot: "Todo o histórico (desde " + L.fDia(ini) + ")" }; p.dias = p.ate - p.de + 1; }
  return { f: f, p: p, spec: { de: p.de, ate: p.ate, f: f, sus: !!L.estado.suspeitos } };
}
function nomeEnt(ent) { return ent.titulo || (ent.dim ? L.nomeDe(ent.dim, ent.id) : "Seleção"); }
function tipoEnt(ent) {
  var base = ent.fonte === "iv" ? "Inventário rotativo" : ent.fonte === "es" ? "Bloqueado hoje" : "Movimentos";
  return ent.dim && L.DIM[ent.dim] ? L.DIM[ent.dim].rot + " · " + base : base;
}

/* ------------------------------ abrir / fechar ------------------------------ */
L.abrirDossie = function (ent, manter) {
  ent = Object.assign({ fonte: "ev" }, ent);
  if (!manter) pilha = [];
  var topo = pilha[pilha.length - 1];
  if (!topo || JSON.stringify(topo) !== JSON.stringify(ent)) pilha.push(ent);
  aba = ent.aba || "resumo";
  L.dica.esconder(); if (L.fecharPopover) L.fecharPopover();
  L.$("dossie").classList.add("on"); L.$("dossie-fundo").classList.add("on");
  document.body.style.overflow = "hidden";
  desenhar();
};
L.fecharDossie = function () { pilha = []; L.$("dossie").classList.remove("on"); L.$("dossie-fundo").classList.remove("on"); document.body.style.overflow = ""; };
L.dossieAberto = function () { return L.$("dossie").classList.contains("on"); };
L.dossieAtual = function () { return pilha[pilha.length - 1] || null; };
document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && L.dossieAberto() && !document.querySelector(".pop")) L.fecharDossie(); });
document.addEventListener("click", function (ev) { if (ev.target && ev.target.id === "dossie-fundo") L.fecharDossie(); });

function desenhar() {
  var ent = pilha[pilha.length - 1], box = L.$("dossie"), es = escopo(ent);
  L.limpar(box);
  box.appendChild(cabecalho(ent, es));
  var corpo = L.h("div", { class: "dos-corpo" });
  box.appendChild(corpo);
  if (pilha.length > 1) {
    var tr = L.h("div", { class: "dos-trilha" });
    pilha.forEach(function (e, i) {
      if (i) tr.appendChild(L.h("span", { text: "›" }));
      tr.appendChild(L.h("button", { type: "button", text: nomeEnt(e), onclick: function () { pilha = pilha.slice(0, i + 1); aba = "resumo"; desenhar(); } }));
    });
    corpo.appendChild(tr);
  }
  var abas = ent.fonte === "iv" ? [["resumo", "Resumo"], ["contagens", "Contagens"]] : ent.fonte === "es" ? [["resumo", "Resumo"], ["movimentos", "Movimentos"]] : [["resumo", "Resumo"], ["movimentos", "Movimentos"]];
  if (ent.dim === "produto") {
    if (ent.fonte === "iv") abas.push(["movimentos", "Movimentos"]); else abas.push(["inventario", "Inventário"]);
    abas.push(["posicao", "Posição hoje"]);
  }
  if (!abas.some(function (a) { return a[0] === aba; })) aba = "resumo";
  var barra = L.h("div", { class: "dos-abas" });
  abas.forEach(function (a) { barra.appendChild(L.h("button", { type: "button", class: aba === a[0] ? "on" : "", text: a[1], onclick: function () { aba = a[0]; desenhar(); } })); });
  corpo.appendChild(barra);
  var conteudo = L.h("div");
  corpo.appendChild(conteudo);
  try {
    var el = aba === "movimentos" ? abaMovimentos(ent, es) : aba === "inventario" || aba === "contagens" ? abaContagens(ent, es) : aba === "posicao" ? abaPosicao(ent, es)
           : ent.fonte === "iv" ? resumoIv(ent, es) : ent.fonte === "es" ? resumoEs(ent, es) : resumoEv(ent, es);
    conteudo.appendChild(el);
    L.executarFila();
  } catch (e) { console.error(e); conteudo.appendChild(L.erroTela("Não foi possível montar o relatório", e.message || String(e))); }
  box.scrollTop = 0;
}

function cabecalho(ent, es) {
  var P = L.P, D = L.D, subs = [], chip = function (ic, t) { return L.h("span", { html: L.ic(ic) + " " + L.esc(t) }); };
  if (ent.fonte !== "es") subs.push(chip("calendario", es.p.rot));
  else subs.push(chip("relogio", "posição de hoje"));
  if (ent.dim === "produto") {
    var pi = P.i.get(+ent.id);
    if (pi != null) { subs.push(chip("caixa", "Cód. " + ent.id + (P.emb[pi] ? " · " + P.emb[pi] : ""))); subs.push(chip("camadas", L.nomeDe("depto", P.dep[pi]) + " › " + L.nomeDe("secao", P.sec[pi]))); subs.push(chip("carteira", L.nomeDe("fornecedor", P.forn[pi]))); }
  } else if (ent.dim === "func") { var s = L.DIM.func.sub(ent.id); if (s) subs.push(chip("pessoas", s)); }
  else if (ent.dim === "inventario") {
    var IV = L.IV; for (var i = 0; i < IV.n; i++) if (IV.i[i] === +ent.id) { subs.push(chip("loja", "Filial " + IV.f[i])); if (IV.uc[i] >= 0) subs.push(chip("pessoas", "Contou: " + L.nomeDe("func", D.funcs[IV.uc[i]][0]))); if (IV.ta[i] >= 0) subs.push(chip("verificar", "Atualizado em " + L.fT(IV.ta[i]))); break; }
  }
  var extra = Object.keys(es.f).filter(function (k) { return es.f[k] && es.f[k].length && k !== ent.dim && !(ent.f && ent.f[k]); }).length;
  if (extra) subs.push(chip("filtro", extra + " filtro" + (extra > 1 ? "s" : "") + " da tela aplicado" + (extra > 1 ? "s" : "")));
  if (ent.f) Object.keys(ent.f).forEach(function (k) { if (L.DIM[k] && ent.f[k] && ent.f[k].length && k !== ent.dim && !ent.titulo) subs.push(chip("etiqueta", L.DIM[k].rot + ": " + ent.f[k].map(function (x) { return L.nomeDe(k, x); }).join(", "))); });
  var acoes = L.h("div", { class: "dos-acoes" });
  if (pilha.length > 1) acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("dir").replace("<svg", '<svg style="transform:rotate(180deg)"') + " Voltar", onclick: function () { pilha.pop(); aba = "resumo"; desenhar(); } }));
  var pag = L.paginaAtual(), filtraveis = (pag.filtros || []).concat(pag.mais || []);
  if (ent.dim && filtraveis.indexOf(ent.dim) >= 0) acoes.appendChild(L.h("button", { class: "btn ouro", type: "button", html: L.ic("filtro") + " Filtrar o painel por isso", onclick: function () { L.setFiltro(ent.dim, [ent.id]); L.fecharDossie(); L.toast("Painel filtrado: " + nomeEnt(ent), "ok"); } }));
  if (ent.dim === "dia" || ent.dim === "mes") acoes.appendChild(L.h("button", { class: "btn ouro", type: "button", html: L.ic("calendario") + " Usar este período no painel", onclick: function () { L.setPeriodo({ r: "livre", de: L.isoDeDia(es.p.de), ate: L.isoDeDia(es.p.ate) }); L.fecharDossie(); } }));
  acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("baixar") + " Imprimir / PDF", onclick: imprimir }));
  acoes.appendChild(L.h("button", { class: "btn-ic", type: "button", title: "Fechar (Esc)", html: L.ic("x"), onclick: L.fecharDossie }));
  var foto = null;
  if (ent.dim === "produto") { var pf = P.i.get(+ent.id); if (pf != null && P.foto[pf]) { var im = L.h("img", { src: L.urlFoto(pf), alt: "", loading: "lazy" }); im.addEventListener("error", function () { foto.remove(); }); foto = L.h("div", { class: "dos-foto" }, im); } }
  return L.h("div", { class: "dos-cab" }, foto,
    L.h("div", { style: { minWidth: 0 } },
      L.h("div", { class: "olho", html: L.ic(ent.dim && L.DIM[ent.dim] ? L.DIM[ent.dim].icone : "estrela").replace("<svg", '<svg style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2"') + "<span>Relatório · " + L.esc(tipoEnt(ent)) + "</span>" }),
      L.h("h2", { text: nomeEnt(ent) }), L.h("div", { class: "sub" }, subs)),
    acoes);
}
function imprimir() {
  var tema = document.documentElement.getAttribute("data-tema");
  document.documentElement.setAttribute("data-tema", "claro"); document.body.classList.add("imprimindo");
  setTimeout(function () { L.redesenharTudo(); window.print(); document.body.classList.remove("imprimindo"); document.documentElement.setAttribute("data-tema", tema); L.redesenharTudo(); }, 250);
}
function idxEv(ent, es) {
  if (ent.suspeitos) { var out = []; for (var i = 0; i < L.EV.n; i++) if (L.EV.sus[i]) out.push(i); var r = Int32Array.from(out); r.suspeitosFora = 0; return r; }
  return L.filtrarEv(es.spec);
}
function quebras(ent, es) {
  var fixas = Object.keys(es.f).filter(function (k) { return es.f[k] && es.f[k].length === 1; });
  return function (lista) { return lista.filter(function (q) { return q[0] !== ent.dim && fixas.indexOf(q[0]) < 0; }); };
}

/* ============================ RESUMO dos movimentos ============================ */
function resumoEv(ent, es) {
  var raiz = L.h("div"), idx = idxEv(ent, es), r = L.resumoEv(idx);
  var cmp = ent.suspeitos || ent.periodoLivre ? null : L.comparacoes(es.p), pa = null, aa = null;
  if (cmp) { if (cmp.pa) pa = L.resumoEv(L.filtrarEv({ de: cmp.pa.de, ate: cmp.pa.ate, f: es.f, sus: es.spec.sus })); if (cmp.aa) aa = L.resumoEv(L.filtrarEv({ de: cmp.aa.de, ate: cmp.aa.ate, f: es.f, sus: es.spec.sus })); }
  var kc = function (campo, inv) { return cmp ? { cmp: cmp, pa: pa ? pa[campo] : null, aa: aa ? aa[campo] : null, inverso: inv } : null; };
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "pulso", rot: "Movimentos", valor: r.n, fmt: L.fInt, classe: "heroi", cmp: kc("n"), leg: L.h("span", { text: L.fInt(r.skus) + " SKUs · " + L.fInt(r.funcs) + " pessoas" }) }),
    L.kpi({ icone: "cadeado", rot: "Entrou no bloqueado", valor: r.ve, fmt: L.fRk, fmtTitulo: L.fR, cmp: kc("ve", true), leg: L.h("span", { text: L.fQ(r.qe) + " un." }) }),
    L.kpi({ icone: "destravar", rot: "Saiu do bloqueado", valor: r.vs, fmt: L.fRk, fmtTitulo: L.fR, cmp: kc("vs"), leg: L.h("span", { text: L.fQ(r.qs) + " un." }) }),
    L.kpi({ icone: "alerta", rot: "Avaria", valor: r.va, fmt: L.fRk, fmtTitulo: L.fR, classe: r.va ? "perigo" : "zero", cmp: kc("va", true), leg: L.h("span", { text: L.fQ(r.qa) + " un. (266 e devoluções)" }) }),
    L.kpi({ icone: "caixa", rot: "Unidades movimentadas", valor: r.q, fmt: L.fQc, fmtTitulo: L.fQ, cmp: kc("q"), leg: L.h("span", { text: L.fInt(r.skus) + " SKUs" }) })));
  if (!r.n) { raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Sem movimento</b>Nada neste recorte e neste período." })); return raiz; }

  // evolução
  var s = L.serieEv(idx, es.p), cE = L.cssVar("--d5"), cS = L.cssVar("--d4"), cN = L.cssVar("--d8");
  if (s.chaves.length > 1) {
    var pEv = L.painel({ titulo: "Evolução por " + (s.gran === "dia" ? "dia" : "mês"), sub: "valor ao custo de hoje · clique para abrir", classe: "c-12" });
    var g = L.h("div"); pEv.corpo.appendChild(g);
    L.graf.colunas(g, { categorias: s.rot, modo: "empilhado", altura: 250, tipo: "moeda", fmt: L.fRc, rotulos: s.chaves.length <= 14,
      series: [{ nome: "Entrou", cor: cE, valores: Array.from(s.ve) }, { nome: "Saiu", cor: cS, valores: Array.from(s.vs) }, { nome: "Neutro", cor: cN, valores: Array.from(s.vn) }],
      dica: function (i) { var k = s.chaves[i]; return { titulo: s.gran === "dia" ? L.nomeDe("dia", k) : L.fMesKLongo(k), linhas: [{ rot: "Entrou", cor: cE, val: L.fR(s.ve[i]) }, { rot: "Saiu", cor: cS, val: L.fR(s.vs[i]) }, { rot: "Neutro", cor: cN, val: L.fR(s.vn[i]) }, { rot: "Movimentos", val: L.fInt(s.n[i]) }] }; },
      aoClicar: function (i) { var k = s.chaves[i], f2 = JSON.parse(JSON.stringify(ent.f || {})); if (ent.dim && ent.dim !== "dia" && ent.dim !== "mes") f2[ent.dim] = [ent.id];
        L.abrirDossie({ dim: s.gran, id: k, f: f2, titulo: nomeEnt(ent) + " · " + (s.gran === "dia" ? L.fDia(k) : L.fMesKLongo(k)) }, true); } });
    raiz.appendChild(L.grade(pEv));
  }
  // quebras
  var lista = quebras(ent, es)([["tipo", "Tipo de movimento"], ["motivo", "Motivos"], ["func", "Quem movimentou"], ["produto", "Produtos"], ["filial", "Filiais"], ["depto", "Departamentos"], ["fornecedor", "Fornecedores"]]).slice(0, 6);
  var gq = L.h("div", { class: "grade", style: { marginTop: "16px" } });
  lista.forEach(function (q) {
    var gr = L.agruparEv(idx, q[0], { ordem: q[0] === "func" ? "n" : "v" }), top = gr.slice(0, 8), med = q[0] === "func" ? "n" : "v", tot = gr.reduce(function (a, x) { return a + (med === "n" ? x.n : x.v); }, 0);
    if (gr.length < 2 && q[0] !== "produto") return;
    var p = L.painel({ titulo: q[1], sub: L.fInt(gr.length) + " no total · " + (med === "n" ? "movimentos" : "valor") + " · clique para abrir", classe: "c-6" });
    var box = L.h("div"); p.corpo.appendChild(box);
    L.graf.barras(box, { itens: top.map(function (x) { return { rot: L.nomeDe(q[0], x.k), valor: med === "n" ? x.n : x.v, cor: q[0] === "tipo" ? L.corTipo(x.k) : null }; }), total: tot, fmt: med === "n" ? L.fInt : L.fRc, linhaH: 27,
      cor: function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
      dica: function (i) { var x = top[i]; return { titulo: L.nomeDe(q[0], x.k), linhas: [{ rot: "Movimentos", val: L.fInt(x.n) }, { rot: "Entrou", val: L.fR(x.ve) }, { rot: "Saiu", val: L.fR(x.vs) }] }; },
      aoClicar: function (i) { var f2 = JSON.parse(JSON.stringify(ent.f || {})); if (ent.dim && ent.dim !== "dia" && ent.dim !== "mes") f2[ent.dim] = [ent.id];
        L.abrirDossie({ dim: q[0], id: top[i].k, f: f2, periodoLivre: ent.periodoLivre }, true); } });
    gq.appendChild(p);
  });
  raiz.appendChild(gq);
  raiz.appendChild(L.nota("Valor ao custo financeiro de hoje. Clique em qualquer barra para abrir o relatório dela (Voltar retorna)."));
  return raiz;
}

/* ============================ MOVIMENTOS (tabela) ============================ */
function abaMovimentos(ent, es) {
  var idx = ent.fonte === "ev" ? idxEv(ent, es) : L.filtrarEv(es.spec);
  var t = L.tabelaMov(idx, { titulo: "Movimentos — " + nomeEnt(ent), porPagina: 25, filtrosTexto: function () { return L.descricaoFiltros([["Relatório", nomeEnt(ent)], ["Período do relatório", es.p.rot]], true); },
    aoClicar: function (i, ev) { if (ent.dim === "produto") return; L.abrirDossie({ dim: "produto", id: L.P.cod[L.EV.p[i]] }, true); } });
  return L.grade(L.painel({ titulo: "Movimentos", sub: L.fInt(idx.length) + " registros · " + es.p.rot, classe: "c-12", semPad: true, corpo: t }));
}

/* ============================ INVENTÁRIO: resumo e contagens ============================ */
function idxIv(ent, es) {
  // contagens de um produto: o histórico inteiro (é o que interessa para saber se ele erra sempre)
  if (ent.fonte !== "iv" && ent.dim === "produto") return L.filtrarIv({ de: null, ate: null, f: { produto: [+ent.id], filial: es.f.filial } });
  return L.filtrarIv(es.spec);
}
function resumoIv(ent, es) {
  var raiz = L.h("div"), idx = idxIv(ent, es), r = L.resumoIv(idx);
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "alvo", rot: "Acurácia", valor: r.acuracia, fmt: function (v) { return L.fPct(v, 1); }, classe: "heroi", leg: L.h("span", { text: L.fInt(r.iguais) + " de " + L.fInt(r.n) + " sem diferença" }) }),
    L.kpi({ icone: "prancheta", rot: "Contagens", valor: r.n, fmt: L.fInt, leg: L.h("span", { text: L.fInt(r.inv) + " inventários · " + L.fInt(r.skus) + " SKUs" }) }),
    L.kpi({ icone: "setaCima", rot: "Sobra", valor: r.vsobra, fmt: L.fRk, fmtTitulo: L.fR, leg: L.h("span", { text: L.fInt(r.sobra) + " produtos · " + L.fQ(r.qsobra) + " un." }) }),
    L.kpi({ icone: "setaBaixo", rot: "Falta", valor: r.vfalta, fmt: L.fRk, fmtTitulo: L.fR, classe: r.vfalta ? "perigo" : "zero", leg: L.h("span", { text: L.fInt(r.falta) + " produtos · " + L.fQ(r.qfalta) + " un." }) }),
    L.kpi({ icone: "ordem", rot: "Ajuste líquido", valor: r.liq, fmt: function (v) { return (v > 0 ? "+" : "") + L.fRk(v); }, fmtTitulo: L.fR, classe: r.liq < 0 ? "perigo" : "ok", leg: L.h("span", { text: "divergência " + L.fPct(r.pctDiv, 1) + " do contado" }) })));
  var lista = quebras(ent, es)([["depto", "Departamentos"], ["func", "Quem contou"], ["produto", "Produtos que mais divergem"], ["resultado", "Resultado"], ["inventario", "Inventários"], ["filial", "Filiais"]]).slice(0, 4);
  var gq = L.h("div", { class: "grade", style: { marginTop: "16px" } });
  lista.forEach(function (q) {
    var gr = L.agruparIv(idx, q[0], { ordem: q[0] === "resultado" || q[0] === "func" ? "n" : "abs" }), top = gr.slice(0, 8);
    if (!gr.length) return;
    var medN = q[0] === "resultado" || q[0] === "func", tot = gr.reduce(function (a, x) { return a + (medN ? x.n : x.abs); }, 0);
    var p = L.painel({ titulo: q[1], sub: (medN ? "contagens" : "sobra + falta (R$)") + " · clique para abrir", classe: "c-6" });
    var box = L.h("div"); p.corpo.appendChild(box);
    L.graf.barras(box, { itens: top.map(function (x) { return { rot: L.nomeDe(q[0], x.k), valor: medN ? x.n : x.abs }; }), total: tot, fmt: medN ? L.fInt : L.fRc, linhaH: 27,
      cor: function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
      dica: function (i) { var x = top[i]; return { titulo: L.nomeDe(q[0], x.k), linhas: [{ rot: "Contagens", val: L.fInt(x.n) }, { rot: "Acurácia", val: L.fPct(x.acuracia, 1) }, { rot: "Sobra", val: L.fR(x.vsobra) }, { rot: "Falta", val: L.fR(x.vfalta) }] }; },
      aoClicar: function (i) { var f2 = JSON.parse(JSON.stringify(ent.f || {})); if (ent.dim && ent.dim !== "dia" && ent.dim !== "mes") f2[ent.dim] = [ent.id];
        L.abrirDossie({ fonte: "iv", dim: q[0], id: top[i].k, f: f2, periodoLivre: ent.periodoLivre || q[0] === "inventario" }, true); } });
    gq.appendChild(p);
  });
  raiz.appendChild(gq);
  raiz.appendChild(abaContagens(ent, es));
  return raiz;
}
function abaContagens(ent, es) {
  var IV = L.IV, P = L.P, D = L.D, idx = idxIv(ent, es), linhas = Array.prototype.slice.call(idx);
  var t = L.tabela({
    titulo: "Contagens — " + nomeEnt(ent), arquivo: "inventario-contagens", aba: "Contagens", porPagina: 25, linhas: linhas, ordem: { id: "dia", desc: true },
    foto: function (i) { return IV.p[i]; }, fotoColuna: "prod", filtrosTexto: function () { return L.descricaoFiltros([["Relatório", nomeEnt(ent)]], true); },
    buscaTexto: function (i) { return P.cod[IV.p[i]] + " " + P.desc[IV.p[i]] + " " + IV.i[i]; },
    colunas: [
      { id: "dia", titulo: "Data", tipo: "texto", valor: function (i) { return IV.dia[i] * 1e7 + IV.i[i]; }, fmt: function (v, i) { return L.fDia(IV.dia[i]); }, exp: function (i) { return L.fDia(IV.dia[i]); } },
      { id: "inv", titulo: "Inventário", tipo: "inteiro", valor: function (i) { return IV.i[i]; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "prod", titulo: "Produto", tipo: "texto", valor: function (i) { return P.desc[IV.p[i]]; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (i) { return P.cod[IV.p[i]]; }, fmt: function (v) { return String(v); }, somar: false, essencial: false },
      { id: "fil", titulo: "Filial", tipo: "inteiro", valor: function (i) { return IV.f[i]; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "qs", titulo: "Estoque (sistema)", tipo: "num", valor: function (i) { return IV.qs[i]; }, fmt: L.fQ, exportarTipo: "inteiro" },
      { id: "qc", titulo: "Contado", tipo: "num", valor: function (i) { return IV.qc[i]; }, fmt: L.fQ, exportarTipo: "inteiro" },
      { id: "dif", titulo: "Diferença", tipo: "num", valor: function (i) { return IV.dif[i]; }, fmt: function (v) { return v > 0.0005 ? "+" + L.fQ(v) : v < -0.0005 ? "−" + L.fQ(-v) : "0"; }, classe: function (v) { return v > 0.0005 ? "pos" : v < -0.0005 ? "neg" : ""; }, exportarTipo: "inteiro" },
      { id: "v", titulo: "Valor do ajuste", tipo: "moeda", valor: function (i) { return IV.vdif[i]; }, classe: function (v) { return v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""; } },
      { id: "c", titulo: "Custo un.", tipo: "num2", valor: function (i) { return IV.c[i]; }, exportarTipo: "moeda", somar: false, essencial: false },
      { id: "fun", titulo: "Contou", tipo: "texto", valor: function (i) { return IV.uc[i] < 0 ? "" : L.nomeDe("func", D.funcs[IV.uc[i]][0]); } },
      { id: "ta", titulo: "Atualizado em", tipo: "texto", valor: function (i) { return IV.ta[i]; }, fmt: function (v, i) { return IV.s[i] === 1 ? "em contagem" : v >= 0 ? L.fT(v) : ""; }, exp: function (i) { return IV.ta[i] >= 0 ? L.fT(IV.ta[i]) : ""; }, essencial: false },
    ],
    totais: function (res) { var rr = L.resumoIv(res.todas || res.linhas); return [{ rot: "Contagens", valor: L.fInt(rr.n), pri: true }, { rot: "Acurácia", valor: L.fPct(rr.acuracia, 1) }, { rot: "Sobra", valor: L.fR(rr.vsobra) }, { rot: "Falta", valor: L.fR(rr.vfalta) }, { rot: "Líquido", valor: L.fR(rr.liq) }]; },
    aoClicar: function (i) { if (ent.dim === "produto") return; L.abrirDossie({ dim: "produto", id: P.cod[IV.p[i]], fonte: "ev", aba: "inventario" }, true); },
    vazio: ent.dim === "produto" ? "Este produto não foi contado em inventário rotativo desde jan/2025." : "Nenhuma contagem neste recorte.",
  });
  var sub = ent.fonte !== "iv" && ent.dim === "produto" ? "todas as contagens do produto desde jan/2025 · positivo = sobra, negativo = falta" : L.fInt(idx.length) + " contagens · " + es.p.rot;
  return L.grade(L.painel({ titulo: "Contagens do inventário rotativo", sub: sub, classe: "c-12", semPad: true, corpo: t }));
}

/* ============================ BLOQUEADO HOJE ============================ */
function resumoEs(ent, es) {
  var raiz = L.h("div"), ES = L.ES, P = L.P, idx = L.filtrarEs({ f: es.f }), r = L.resumoEs(idx);
  var todo = L.resumoEs(L.filtrarEs({ f: es.f, todos: true })); r.ve = todo.ve; r.pct = r.ve ? r.vb / r.ve : null;
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "armazem", rot: "Bloqueado hoje", valor: r.vb, fmt: L.fRk, fmtTitulo: L.fR, classe: "heroi", leg: L.h("span", { text: L.fQ(r.qb) + " un. · " + L.fInt(r.skus) + " SKUs" }) }),
    L.kpi({ icone: "alerta", rot: "Em avaria", valor: r.va, fmt: L.fRk, fmtTitulo: L.fR, classe: r.va ? "perigo" : "zero", leg: L.h("span", { text: L.fQ(r.qa) + " un." }) }),
    L.kpi({ icone: "cadeado", rot: "Outros bloqueios", valor: r.vo, fmt: L.fR }),
    L.kpi({ icone: "percent", rot: "Do estoque", valor: r.pct, fmt: function (v) { return L.fPct(v, 1); }, leg: L.h("span", { text: "de " + L.fRc(r.ve) + " em estoque" }) })));
  raiz.appendChild(abaPosicaoLista(idx, "Produtos bloqueados — " + nomeEnt(ent)));
  return raiz;
}
function abaPosicao(ent, es) {
  var ES = L.ES, pi = L.P.i.get(+ent.id), linhas = [];
  for (var s = 0; s < ES.n; s++) if (ES.p[s] === pi) linhas.push(s);
  var raiz = L.h("div");
  var vb = 0, va = 0, ve = 0; linhas.forEach(function (s) { vb += ES.b[s] * ES.c[s]; va += ES.a[s] * ES.c[s]; ve += Math.max(0, ES.e[s]) * ES.c[s]; });
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "armazem", rot: "Bloqueado hoje", valor: vb, fmt: L.fRk, fmtTitulo: L.fR, classe: "heroi" }),
    L.kpi({ icone: "alerta", rot: "Em avaria", valor: va, fmt: L.fRk, fmtTitulo: L.fR, classe: va ? "perigo" : "zero" }),
    L.kpi({ icone: "caixa", rot: "Estoque (custo)", valor: ve, fmt: L.fRk, fmtTitulo: L.fR, leg: L.h("span", { text: "todas as filiais com registro" }) })));
  raiz.appendChild(abaPosicaoLista(Int32Array.from(linhas), "Posição por filial", true));
  return raiz;
}
function abaPosicaoLista(idx, titulo, todas) {
  var ES = L.ES, P = L.P, D = L.D, hoje = L.hojeDia();
  var t = L.tabela({ titulo: titulo, arquivo: "bloqueado-hoje", aba: "Bloqueado hoje", porPagina: 25, linhas: Array.prototype.slice.call(idx), ordem: { id: "vb", desc: true },
    foto: function (s) { return ES.p[s]; }, fotoColuna: "prod", buscaTexto: function (s) { return P.cod[ES.p[s]] + " " + P.desc[ES.p[s]]; },
    colunas: [
      { id: "prod", titulo: "Produto", tipo: "texto", valor: function (s) { return P.desc[ES.p[s]]; } },
      { id: "fil", titulo: "Filial", tipo: "inteiro", valor: function (s) { return ES.f[s]; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "e", titulo: "Estoque", tipo: "num", valor: function (s) { return ES.e[s]; }, fmt: L.fQ, exportarTipo: "inteiro" },
      { id: "r", titulo: "Reservado", tipo: "num", valor: function (s) { return ES.r[s]; }, fmt: L.fQ, exportarTipo: "inteiro", essencial: !!todas },
      { id: "b", titulo: "Bloqueado", tipo: "num", valor: function (s) { return ES.b[s]; }, fmt: L.fQ, exportarTipo: "inteiro" },
      { id: "a", titulo: "Avaria", tipo: "num", valor: function (s) { return ES.a[s]; }, fmt: function (v) { return v ? L.fQ(v) : ""; }, exportarTipo: "inteiro" },
      { id: "vb", titulo: "R$ bloqueado", tipo: "moedaInt", valor: function (s) { return ES.b[s] * ES.c[s]; }, barra: true, exportarTipo: "moeda" },
      { id: "ult", titulo: "Último bloqueio", tipo: "texto", valor: function (s) { return ES.ultBloq[s]; }, fmt: function (v) { return v >= 0 ? L.fDia(v) + " (" + L.fInt(hoje - v) + " dias)" : "—"; }, exp: function (s) { return ES.ultBloq[s] >= 0 ? L.fDia(ES.ultBloq[s]) : ""; } },
      { id: "mot", titulo: "Motivo", tipo: "texto", valor: function (s) { var m = ES.motUlt[s]; return m < 0 ? "" : L.nomeDe("motivo", D.motivos[m][0]); } },
    ],
    aoClicar: function (s) { L.abrirDossie({ dim: "produto", id: P.cod[ES.p[s]] }, true); },
    vazio: "Nada bloqueado neste recorte." });
  return L.grade(L.painel({ titulo: titulo, sub: "posição do PCEST na última carga · valor ao custo financeiro", classe: "c-12", semPad: true, corpo: t }));
}

})();
