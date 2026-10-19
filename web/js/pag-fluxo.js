/* =============================================================================
 * pag-fluxo.js — DEVOLUÇÕES E WMS: o que entra bloqueado sozinho e quem libera.
 *   · devolução de cliente (1303, 1346, 1361) entra BLOQUEADA;
 *   · o WMS da Kaizen libera depois da armazenagem (recebimento e devolução);
 *   · 1316 cancela a devolução (estorna a entrada, não mexe no bloqueado).
 * A devolução e a liberação do WMS carregam a mesma transação de entrada: dá para
 * medir quanto tempo cada devolução ficou esperando a armazenagem.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var DEV = [7, 11, 12];

L.registrarPagina({
  id: "fluxo", grupo: "Rotina 266", menu: "Devoluções e WMS", icone: "caminhao",
  titulo: "Devoluções e liberações do WMS", olho: "O que entra bloqueado sozinho e quem libera",
  filtros: ["filial", "motivo", "depto", "fornecedor", "produto"],
  mais: ["secao", "dow", "hora"],
  render: render,
});

/* índice das notas de devolução (transação de entrada), montado uma vez por carga */
L.docsDevolucao = function () {
  if (L._docs && L._docs.versao === L.META.versao) return L._docs.m;
  var EV = L.EV, m = new Map(), i, x;
  for (i = 0; i < EV.n; i++) {
    var d = EV.d[i], k = EV.k[i];
    if (!d || DEV.indexOf(k) < 0) continue;
    x = m.get(d);
    if (!x) { x = { d: d, f: EV.f[i], tEnt: EV.t[i], qEnt: 0, vEnt: 0, itens: new Set(), mot: EV.m[i], u: EV.u[i], tLib: -1, qLib: 0, vLib: 0, cancel: false, k: k }; m.set(d, x); }
    if (EV.t[i] < x.tEnt) x.tEnt = EV.t[i];
    x.qEnt += EV.q[i]; x.vEnt += EV.v[i]; x.itens.add(EV.p[i]);
  }
  for (i = 0; i < EV.n; i++) {
    x = EV.d[i] ? m.get(EV.d[i]) : null; if (!x) continue;
    if (EV.k[i] === 6) { x.qLib += EV.q[i]; x.vLib += EV.v[i]; if (EV.t[i] > x.tLib) x.tLib = EV.t[i]; }
    else if (EV.k[i] === 8) x.cancel = true;
  }
  m.forEach(function (x) {
    x.nItens = x.itens.size; x.itens = null;
    x.sit = x.cancel ? 3 : x.qLib >= x.qEnt - 0.001 && x.qLib > 0 ? 0 : x.qLib > 0 ? 1 : 2;
    x.horas = x.sit === 0 && x.tLib >= x.tEnt ? (x.tLib - x.tEnt) / 60 : null;
  });
  L._docs = { versao: L.META.versao, m: m };
  return m;
};
L.SIT_DOC = [["Liberada", "ok"], ["Em parte", "atencao"], ["Sem WMS", "neutro"], ["Cancelada", "info"]];   // curto: cabe na coluna; o significado está no subtítulo
function mediana(a) { if (!a.length) return null; a = a.slice().sort(function (x, y) { return x - y; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

function render(raiz) {
  var p = L.periodo(), cmp = L.comparacoes(p), EV = L.EV, med = L.medida(), M = L.MEDIDAS[med];
  var ctxDev = L.ctxEv({ tipo: DEV }), ctxWms = L.ctxEv({ tipo: [6] }), ctxCan = L.ctxEv({ tipo: [8] });
  var aviso = L.avisoSuspeitos(ctxDev.idx); if (aviso) raiz.appendChild(aviso);
  var docs = L.docsDevolucao();
  var docsDe = function (idx) { var s = new Set(), out = []; for (var j = 0; j < idx.length; j++) { var d = EV.d[idx[j]]; if (d && !s.has(d)) { s.add(d); var x = docs.get(d); if (x) out.push(x); } } return out; };
  var lista = docsDe(ctxDev.idx);
  var tempos = function (l) { return mediana(l.filter(function (x) { return x.horas != null; }).map(function (x) { return x.horas; })); };
  var hMed = tempos(lista), hPa = ctxDev.idxPa ? tempos(docsDe(ctxDev.idxPa)) : null, hAa = ctxDev.idxAa ? tempos(docsDe(ctxDev.idxAa)) : null;
  var semLib = lista.filter(function (x) { return x.sit === 2; }).length;

  raiz.appendChild(L.kpis(
    L.kpi({ icone: "devolucao", rot: "Devoluções que entraram bloqueadas", valor: ctxDev.res.ve, fmt: L.fRk, fmtTitulo: L.fR, classe: "heroi", cmp: ctxDev.kc("ve", true),
            leg: L.h("span", { text: L.fInt(lista.length) + " notas · " + L.fQ(ctxDev.res.qe) + " un." }), aoClicar: function () { L.abrirDossie({ titulo: "Devoluções de cliente", f: { tipo: DEV } }); } }),
    L.kpi({ icone: "destravar", rot: "Liberado pelo WMS", valor: ctxWms.res.vs, fmt: L.fRk, fmtTitulo: L.fR, classe: ctxWms.res.vs ? "ok" : "zero", cmp: ctxWms.kc("vs"),
            leg: L.h("span", { text: L.fInt(ctxWms.res.n) + " liberações · recebimentos e devoluções" }), aoClicar: function () { L.abrirDossie({ titulo: "Liberações do WMS", f: { tipo: [6] } }); } }),
    L.kpi({ icone: "relogio", rot: "Tempo até o WMS liberar", valor: hMed, fmt: L.fHoras, texto: hMed == null ? "—" : null,
            cmp: { cmp: cmp, pa: hPa, aa: hAa, inverso: true }, leg: L.h("span", { text: "mediana, da entrada da devolução à última liberação" }), ajuda: "Só notas de devolução que o WMS liberou por inteiro" }),
    L.kpi({ icone: "x", rot: "Devoluções canceladas", valor: ctxCan.res.vn, fmt: L.fRk, fmtTitulo: L.fR, classe: ctxCan.res.vn ? "violeta" : "zero", cmp: ctxCan.kc("vn"),
            leg: L.h("span", { text: L.fInt(ctxCan.res.n) + " itens estornados na 1316" }), aoClicar: function () { L.abrirDossie({ titulo: "Devoluções canceladas (1316)", f: { tipo: [8] } }); } }),
    L.kpi({ icone: "info", rot: "Sem liberação do WMS", valor: semLib, fmt: L.fInt, classe: semLib ? "" : "zero",
            leg: L.h("span", { text: "notas do período · podem ter sido liberadas à mão na 266" }), ajuda: "A 266 não grava a transação: uma devolução liberada à mão aparece aqui" })));

  // ---------------- devoluções × liberações
  var sDev = L.serieEv(ctxDev.idx, p), sWms = L.serieEv(ctxWms.idx, p), gran = sDev.gran;
  var pEv = L.painel({ titulo: "Devoluções × liberações do WMS por " + (gran === "dia" ? "dia" : "mês"), sub: M.nome.toLowerCase() + " · clique numa coluna para abrir", classe: "c-12", acoes: [L.segMedida()] });
  var g = L.h("div"); pEv.corpo.appendChild(g);
  var cDv = L.cssVar("--d6"), cW = L.cssVar("--d2");
  var val = function (s, suf) { return Array.from(med === "n" ? s["n" + suf] : med === "q" ? s["q" + suf] : s["v" + suf]); };
  var a1 = val(sDev, "e"), a2 = val(sWms, "s");
  L.graf.colunas(g, {
    categorias: sDev.rot, modo: "agrupado", altura: 280, tipo: M.tipo, fmt: M.fmt, rotulos: sDev.chaves.length <= 14,
    series: [{ nome: "Devoluções", cor: cDv, valores: a1 }, { nome: "Liberado pelo WMS", cor: cW, valores: a2 }],
    dica: function (i) { var k = sDev.chaves[i]; return { titulo: gran === "dia" ? L.nomeDe("dia", k) : L.fMesKLongo(k), linhas: [
      { rot: "Devoluções (entraram bloqueadas)", cor: cDv, val: L.fR(sDev.ve[i]) + " · " + L.fInt(sDev.ne[i]) + " itens" },
      { rot: "Liberado pelo WMS", cor: cW, val: L.fR(sWms.vs[i]) + " · " + L.fInt(sWms.ns[i]) + " liberações" }] }; },
    aoClicar: function (i, si) { var k = sDev.chaves[i]; L.abrirDossie({ dim: gran, id: k, f: { tipo: si === 1 ? [6] : DEV }, titulo: (gran === "dia" ? L.nomeDe("dia", k) : L.fMesKLongo(k)) + " · " + (si === 1 ? "liberações do WMS" : "devoluções") }); },
  });
  pEv.corpo.appendChild(L.graf.legenda([{ rot: "Devoluções de cliente (entram bloqueadas)", cor: cDv }, { rot: "Liberado pelo WMS (recebimento e devolução)", cor: cW }]));
  raiz.appendChild(L.grade(pEv));

  // ---------------- motivos e horas
  var pMot = L.painel({ titulo: "Por que o cliente devolveu", sub: "motivo da devolução · " + M.nome.toLowerCase(), classe: "c-6" });
  L.barrasDim(pMot.corpo, ctxDev.idx, "motivo", 8, med);
  var pHora = L.painel({ titulo: "A que horas o WMS libera", sub: "liberações por hora do dia · clique para abrir", classe: "c-6" });
  var porHora = new Float64Array(24);
  for (var j = 0; j < ctxWms.idx.length; j++) porHora[Math.floor((EV.t[ctxWms.idx[j]] % 1440) / 60)]++;
  var h0 = 23, h1 = 0; for (var h = 0; h < 24; h++) if (porHora[h]) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); }
  if (h0 > h1) { h0 = 6; h1 = 18; }
  var hs = []; for (h = h0; h <= h1; h++) hs.push(h);
  var gH = L.h("div"); pHora.corpo.appendChild(gH);
  L.graf.colunas(gH, { categorias: hs.map(function (x) { return x + "h"; }), series: [{ nome: "Liberações", cor: cW, valores: hs.map(function (x) { return porHora[x]; }) }], altura: 250, fmt: function (v) { return L.fAbrev(v, false); },
    dica: function (i) { return { titulo: hs[i] + "h às " + (hs[i] + 1) + "h", linhas: [{ rot: "Liberações do WMS", val: L.fInt(porHora[hs[i]]) }] }; },
    aoClicar: function (i) { L.abrirDossie({ titulo: "Liberações do WMS das " + hs[i] + "h", f: { tipo: [6], hora: [hs[i]] } }); } });
  raiz.appendChild(L.grade(pMot, pHora));

  // ---------------- notas de devolução
  var tab = L.tabela({
    titulo: "Notas de devolução", arquivo: "devolucoes-e-liberacao-wms", aba: "Devoluções", porPagina: 25, linhas: lista, ordem: { id: "ent", desc: true },
    buscaTexto: function (x) { return x.d + " " + L.nomeDe("motivo", x.mot < 0 ? -1 : L.D.motivos[x.mot][0]); },
    colunas: [
      { id: "doc", titulo: "Transação", tipo: "inteiro", valor: function (x) { return x.d; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "ent", titulo: "Entrou em", tipo: "texto", valor: function (x) { return x.tEnt; }, fmt: function (v) { return L.fT(v); }, exp: function (x) { return L.fT(x.tEnt); } },
      { id: "fil", titulo: "Filial", tipo: "inteiro", valor: function (x) { return x.f; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "mot", titulo: "Motivo", tipo: "texto", valor: function (x) { return x.mot < 0 ? "" : L.nomeDe("motivo", L.D.motivos[x.mot][0]); } },
      { id: "it", titulo: "Itens", tipo: "inteiro", valor: function (x) { return x.nItens; } },
      { id: "v", titulo: "Valor", tipo: "moedaInt", valor: function (x) { return x.vEnt; }, barra: true, exportarTipo: "moeda" },
      { id: "vl", titulo: "Liberado pelo WMS", tipo: "moedaInt", valor: function (x) { return x.vLib; }, exportarTipo: "moeda" },
      { id: "lib", titulo: "Liberada em", tipo: "texto", valor: function (x) { return x.tLib; }, fmt: function (v) { return v >= 0 ? L.fT(v) : ""; }, exp: function (x) { return x.tLib >= 0 ? L.fT(x.tLib) : ""; } },
      { id: "h", titulo: "Tempo", tipo: "num", valor: function (x) { return x.horas; }, fmt: function (v) { return v == null ? "" : L.fHoras(v); }, exportarTipo: "inteiro", tituloExp: "Horas até liberar" },
      { id: "sit", titulo: "Situação", tipo: "tag", valor: function (x) { return L.SIT_DOC[x.sit][0]; }, fmt: function (v, x) { return { html: L.tag(L.SIT_DOC[x.sit][0], L.SIT_DOC[x.sit][1]) }; } },
      { id: "fun", titulo: "Lançou", tipo: "texto", valor: function (x) { return x.u < 0 ? "" : L.nomeDe("func", L.D.funcs[x.u][0]); }, essencial: false },
    ],
    totais: function (res) {
      var l = res.todas || res.linhas, v = 0, vl = 0; l.forEach(function (x) { v += x.vEnt; vl += x.vLib; });
      return [{ rot: "Notas", valor: L.fInt(l.length), pri: true }, { rot: "Valor devolvido", valor: L.fR(v) }, { rot: "Liberado pelo WMS", valor: L.fR(vl) }, { rot: "Tempo mediano", valor: L.fHoras(tempos(l)) }];
    },
    aoClicar: function (x) { L.abrirDossie({ dim: "doc", id: x.d, titulo: "Devolução · transação " + x.d, periodoLivre: true }); },
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Notas de devolução do período", sub: "uma linha por transação de entrada · situação: Liberada (o WMS liberou tudo), Em parte, Sem WMS (não passou pelo WMS; pode ter sido liberada à mão na 266) ou Cancelada (1316) · clique para ver item a item", classe: "c-12", semPad: true, corpo: tab })));
  raiz.appendChild(L.nota("O recebimento de compra (1301) também entra bloqueado até o WMS armazenar, mas o WinThor só registra no livro a LIBERAÇÃO — por isso as liberações do WMS são maiores que as devoluções. O tempo é medido da entrada da devolução até a última liberação do WMS da mesma transação."));
}

})();
