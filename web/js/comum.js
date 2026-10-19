/* =============================================================================
 * comum.js — peças que as telas dividem: formatos, contexto (filtro + período +
 * comparações), escolha de medida, aviso de movimento suspeito, linhas de feed e
 * as colunas padrão das tabelas de movimento.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ formatos ------------------------------ */
L.fR = function (v) { return L.fBRL(v, 0); };                      // R$ 12.345
L.fRc = function (v) { return L.fAbrev(v, true); };                // R$ 12,3 mil
L.fRk = function (v) { return Math.abs(v) >= 1e6 ? L.fAbrev(v, true) : L.fBRL(v, 0); };   // cartão: R$ 388.907 ou R$ 11,26 mi
L.fQ = function (v) { return v == null || isNaN(v) ? "—" : L.fNum(v, Math.abs(v % 1) > 0.0005 ? (Math.abs(v) < 10 ? 2 : 1) : 0); };
L.fQc = function (v) { return L.fAbrev(v, false); };
L.fHoras = function (h) {
  if (h == null || !isFinite(h)) return "—";
  if (h < 1) return L.fInt(h * 60) + " min";
  if (h < 48) return L.fNum(h, h < 10 ? 1 : 0) + " h";
  return L.fNum(h / 24, h / 24 < 10 ? 1 : 0) + " dias";
};

/* medida escolhida nos gráficos de movimento (vale para a tela inteira) */
L.MEDIDAS = {
  v: { rot: "R$", nome: "Valor (R$)", fmt: L.fRc, fmtL: L.fR, tipo: "moeda" },
  n: { rot: "Movimentos", nome: "Movimentos", fmt: function (v) { return L.fAbrev(v, false); }, fmtL: L.fInt },
  q: { rot: "Unidades", nome: "Unidades", fmt: L.fQc, fmtL: L.fQ },
};
L.medida = function () { return L.estado.medida || "v"; };
L.segMedida = function () {
  var seg = L.h("div", { class: "seg", title: "O que os gráficos de movimento medem" });
  ["v", "n", "q"].forEach(function (k) {
    seg.appendChild(L.h("button", { type: "button", class: L.medida() === k ? "on" : "", text: L.MEDIDAS[k].rot, onclick: function () { L.estado.medida = k; L.sincronizarHash(); L.emitir("filtros"); } }));
  });
  return seg;
};
/* valor da medida num grupo de L.agruparEv, por sentido (e = entrou, s = saiu, n = neutro, "" = tudo) */
L.valorMedida = function (g, sentido, medida) {
  medida = medida || L.medida();
  var suf = sentido || "";
  if (medida === "n") return suf === "e" ? g.ne || 0 : suf === "s" ? g.ns || 0 : suf === "n" ? g.nn || 0 : g.n;
  return g[(medida === "v" ? "v" : "q") + suf] || 0;
};

/* ------------------------------ contexto de uma tela ------------------------------ */
/* filtra o período e os dois comparativos com os MESMOS filtros; fixo = filtros da própria tela */
L.ctxEv = function (fixo) {
  var p = L.periodo(), cmp = L.comparacoes(p), extra = fixo ? { f: fixo } : null;
  var idx = L.filtrarEv(L.spec(extra, p)), res = L.resumoEv(idx);
  var ia = cmp.pa ? L.filtrarEv(L.spec(extra, cmp.pa)) : null, iy = cmp.aa ? L.filtrarEv(L.spec(extra, cmp.aa)) : null;
  var pa = ia ? L.resumoEv(ia) : null, aa = iy ? L.resumoEv(iy) : null;
  return { p: p, cmp: cmp, fixo: fixo || {}, idx: idx, res: res, pa: pa, aa: aa, idxPa: ia, idxAa: iy,
    kc: function (campo, inverso) {
      var f = typeof campo === "function" ? campo : function (r) { return r[campo]; };
      return { cmp: cmp, pa: pa ? f(pa) : null, aa: aa ? f(aa) : null, inverso: !!inverso };
    } };
};
L.ctxIv = function (fixo) {
  var p = L.periodo(), cmp = L.comparacoes(p), extra = fixo ? { f: fixo } : null;
  var idx = L.filtrarIv(L.spec(extra, p)), res = L.resumoIv(idx);
  var pa = cmp.pa ? L.resumoIv(L.filtrarIv(L.spec(extra, cmp.pa))) : null, aa = cmp.aa ? L.resumoIv(L.filtrarIv(L.spec(extra, cmp.aa))) : null;
  return { p: p, cmp: cmp, idx: idx, res: res, pa: pa, aa: aa,
    kc: function (campo, inverso, pp) {
      var f = typeof campo === "function" ? campo : function (r) { return r[campo]; };
      return { cmp: cmp, pa: pa && pa.n ? f(pa) : null, aa: aa && aa.n ? f(aa) : null, inverso: !!inverso, pp: !!pp };
    } };
};

/* ------------------------------ avisos ------------------------------ */
/* movimento suspeito fora das somas: nada some em silêncio */
L.avisoSuspeitos = function (idx) {
  var n = idx && idx.suspeitosFora;
  if (!n && !L.estado.suspeitos) return null;
  var EV = L.EV;
  if (L.estado.suspeitos) return L.h("div", { class: "aviso-faixa atencao" }, L.icEl("aviso"),
    L.h("span", { html: "As somas desta tela <b>incluem</b> movimento(s) com quantidade acima de " + L.fInt(L.LIMITE_SUSPEITO) + " un. num registro só — quase certo erro de digitação no WinThor." }),
    L.h("button", { class: "mini-btn", type: "button", text: "Tirar das somas", onclick: function () { L.setSuspeitos(false); } }));
  var ex = [];
  for (var i = 0; i < EV.n && ex.length < 2; i++) if (EV.sus[i] && EV.dia[i] >= L.periodo().de && EV.dia[i] <= L.periodo().ate) ex.push(i);
  var txt = ex.map(function (i) { return L.fQ(EV.q[i]) + " un. de " + L.P.desc[EV.p[i]] + " (" + L.TIPOS[EV.k[i]].nome.toLowerCase() + " em " + L.fDia(EV.dia[i]) + ")"; }).join("; ");
  return L.h("div", { class: "aviso-faixa atencao" }, L.icEl("aviso"),
    L.h("span", { html: "<b>" + n + " movimento" + (n > 1 ? "s" : "") + " fora das somas</b>: " + L.esc(txt) + ". Quantidade impossível num registro só (acima de " + L.fInt(L.LIMITE_SUSPEITO) + " un.): corrija na origem, no WinThor." }),
    L.h("button", { class: "mini-btn", type: "button", text: "Ver", onclick: function () { L.abrirDossie({ titulo: "Movimentos suspeitos", fonte: "ev", suspeitos: true, f: {} }); } }),
    L.h("button", { class: "mini-btn", type: "button", text: "Incluir nas somas", onclick: function () { L.setSuspeitos(true); } }));
};

/* clique padrão: abre o relatório do item; Ctrl+clique aplica como filtro */
L.clique = function (dim, id, ev, extra) {
  if (ev && (ev.ctrlKey || ev.metaKey) && L.DIM[dim] && (L.paginaAtual().filtros || []).concat(L.paginaAtual().mais || []).indexOf(dim) >= 0) { L.alternarFiltro(dim, id); L.toast("Filtro: " + L.nomeDe(dim, id)); return; }
  L.abrirDossie(Object.assign({ dim: dim, id: id }, extra || {}), !!(L.dossieAberto && L.dossieAberto()));
};

/* ------------------------------ peças de tabela ------------------------------ */
L.tagTipo = function (k) { var t = L.TIPOS[k]; return '<span class="tag tipo" style="--c:var(' + t.cor + ')">' + L.esc(t.curto) + "</span>"; };
/* colunas de uma tabela de MOVIMENTOS (linha = índice em L.EV) */
L.colunasMov = function () {
  var EV = L.EV, P = L.P, D = L.D;
  return [
    { id: "dt", titulo: "Data e hora", tipo: "texto", alinhar: "esq", valor: function (i) { return EV.t[i]; }, fmt: function (v) { return L.fT(v); }, exp: function (i) { return L.fT(EV.t[i]); } },
    { id: "tipo", titulo: "Movimento", tipo: "tag", valor: function (i) { return L.TIPOS[EV.k[i]].nome; }, fmt: function (v, i) { return { html: L.tagTipo(EV.k[i]) }; }, exp: function (i) { return L.TIPOS[EV.k[i]].nome; } },
    { id: "prod", titulo: "Produto", tipo: "texto", valor: function (i) { return P.desc[EV.p[i]] || ""; } },
    { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (i) { return P.cod[EV.p[i]]; }, fmt: function (v) { return String(v); }, somar: false, essencial: false },
    { id: "fil", titulo: "Filial", tipo: "inteiro", valor: function (i) { return EV.f[i]; }, fmt: function (v) { return String(v); }, somar: false },
    { id: "qt", titulo: "Quantidade", tipo: "num", valor: function (i) { return EV.q[i]; }, fmt: function (v) { return L.fQ(v); }, exportarTipo: "inteiro" },
    { id: "un", titulo: "Emb.", tipo: "texto", valor: function (i) { return P.emb[EV.p[i]]; }, essencial: false },
    { id: "val", titulo: "Valor (custo de hoje)", tipo: "moeda", valor: function (i) { return EV.v[i]; }, barra: true },
    { id: "av", titulo: "Avaria (un.)", tipo: "num", valor: function (i) { return EV.a[i] || null; }, fmt: function (v) { return v ? L.fQ(v) : ""; }, exportarTipo: "inteiro", essencial: false },
    { id: "mot", titulo: "Motivo", tipo: "texto", valor: function (i) { return EV.m[i] < 0 ? "" : L.nomeDe("motivo", D.motivos[EV.m[i]][0]); } },
    { id: "fun", titulo: "Funcionário", tipo: "texto", valor: function (i) { return EV.u[i] < 0 ? "" : L.nomeDe("func", D.funcs[EV.u[i]][0]); } },
    { id: "rot", titulo: "Rotina", tipo: "texto", valor: function (i) { return L.ROTINAS[L.TIPOS[EV.k[i]].g].nome; }, essencial: false },
    { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (i) { return L.nomeDe("fornecedor", P.forn[EV.p[i]]); }, essencial: false },
    { id: "dep", titulo: "Departamento", tipo: "texto", valor: function (i) { return L.nomeDe("depto", P.dep[EV.p[i]]); }, essencial: false },
    { id: "sec", titulo: "Seção", tipo: "texto", valor: function (i) { return L.nomeDe("secao", P.sec[EV.p[i]]); }, essencial: false },
    { id: "custo", titulo: "Custo un. (hoje)", tipo: "num2", valor: function (i) { return L.custoDe(EV.f[i], EV.p[i]); }, exportarTipo: "moeda", essencial: false, somar: false },
    { id: "doc", titulo: "Transação", tipo: "inteiro", valor: function (i) { return EV.d[i] || null; }, fmt: function (v) { return v ? String(v) : ""; }, somar: false, essencial: false },
  ];
};
L.tabelaMov = function (idx, cfg) {
  cfg = cfg || {};
  var EV = L.EV, P = L.P;
  var linhas = Array.prototype.slice.call(idx);
  return L.tabela(Object.assign({
    titulo: "Movimentos", arquivo: "movimentos-inventario", aba: "Movimentos", porPagina: 25, ordem: { id: "dt", desc: true },
    linhas: linhas, colunas: L.colunasMov(), foto: function (i) { return EV.p[i]; }, fotoColuna: "prod",
    buscaDica: "Buscar produto, código, funcionário, motivo ou transação…",
    buscaTexto: function (i) { return P.desc[EV.p[i]] + " " + P.cod[EV.p[i]] + " " + (EV.u[i] >= 0 ? L.D.funcs[EV.u[i]][1] : "") + " " + (EV.m[i] >= 0 ? L.D.motivos[EV.m[i]][1] : "") + " " + L.TIPOS[EV.k[i]].nome + " " + (EV.d[i] || ""); },
    totais: function (res) {
      var r = L.resumoEv(res.todas || res.linhas);
      return [{ rot: "Movimentos", valor: L.fInt(r.n), pri: true }, { rot: "Entrou no bloqueado", valor: L.fR(r.ve) }, { rot: "Saiu do bloqueado", valor: L.fR(r.vs) }, { rot: "SKUs", valor: L.fInt(r.skus) }];
    },
    aoClicar: function (i, ev) { L.clique("produto", P.cod[EV.p[i]], ev); },
    vazio: "Nenhum movimento com os filtros e o período atuais.",
  }, cfg));
};

/* linha do "feed" de últimos movimentos */
L.feedMov = function (idx, n) {
  var EV = L.EV, P = L.P, D = L.D, box = L.h("div", { class: "feed" });
  var ultimos = [];
  for (var j = idx.length - 1; j >= 0 && ultimos.length < n; j--) ultimos.push(idx[j]);
  if (!ultimos.length) { box.appendChild(L.h("div", { class: "vazio", html: "<b>Sem movimento</b>Nada no período e nos filtros atuais." })); return box; }
  var diaAnt = null;
  ultimos.forEach(function (i) {
    if (EV.dia[i] !== diaAnt) { diaAnt = EV.dia[i]; box.appendChild(L.h("div", { class: "feed-dia", text: L.nomeDe("dia", EV.dia[i]) })); }
    var t = L.TIPOS[EV.k[i]];
    var linha = L.h("button", { class: "feed-item", type: "button", onclick: function (ev) { L.clique("produto", P.cod[EV.p[i]], ev); } },
      L.h("span", { class: "feed-hora num", text: L.fHora(EV.t[i]) }),
      L.h("span", { class: "feed-tipo", html: L.tagTipo(EV.k[i]) }),
      L.fotoMini(EV.p[i]),
      L.h("span", { class: "feed-prod" }, L.h("b", { text: P.desc[EV.p[i]] }),
        L.h("small", { text: "cód. " + P.cod[EV.p[i]] + " · filial " + EV.f[i] + (EV.m[i] >= 0 && t.g !== 1 ? " · " + L.nomeDe("motivo", D.motivos[EV.m[i]][0]) : "") + (EV.u[i] >= 0 && D.funcs[EV.u[i]][0] !== 1 ? " · " + L.nomeDe("func", D.funcs[EV.u[i]][0]) : "") })),
      L.h("span", { class: "feed-qt num", html: (t.s === 1 ? '<i class="seta-e">▲</i>' : t.s === -1 ? '<i class="seta-s">▼</i>' : "") + L.esc(L.fQ(EV.q[i])) + " <small>" + L.esc(P.emb[EV.p[i]] || "un.") + "</small>" }),
      L.h("span", { class: "feed-val num", text: L.fR(EV.v[i]) }));
    box.appendChild(linha);
  });
  return box;
};

/* R$ bloqueado hoje por produto (índice), respeitando o filtro de filial da tela */
L.bloqueadoHojePorProduto = function () {
  var ES = L.ES, fil = L.estado.filtros.filial, m = new Map();
  for (var s = 0; s < ES.n; s++) {
    if (!(ES.b[s] > 0) || (fil && fil.length && fil.indexOf(ES.f[s]) < 0)) continue;
    m.set(ES.p[s], (m.get(ES.p[s]) || 0) + ES.b[s] * ES.c[s]);
  }
  return m;
};

/* rótulo curto de um grupo para eixos e barras */
L.rotGrupo = function (dim, k) { var d = L.DIM[dim]; return d && d.curto ? d.curto(k) : L.nomeDe(dim, k); };

})();
