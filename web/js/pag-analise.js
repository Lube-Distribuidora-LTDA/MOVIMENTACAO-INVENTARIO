/* =============================================================================
 * pag-analise.js — ANÁLISE LIVRE: a tabela que o usuário monta.
 * Escolhe a base (movimentos, inventário, bloqueado hoje), o que vai nas linhas,
 * o que vai nas colunas (opcional) e a medida. Tabela com cor de calor, totais,
 * Excel com os filtros escritos, e clique em qualquer célula abre o relatório.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

var FONTES = {
  ev: { rot: "Movimentos do bloqueado (266, WMS, devoluções)",
        dims: ["tipo", "rotina", "sentido", "motivo", "func", "filial", "depto", "secao", "fornecedor", "produto", "mes", "dia", "dow", "hora"],
        medidas: {
          v: { rot: "Valor movimentado (R$)", fmt: L.fR, ini: 0, add: function (g, i) { g.x += L.EV.v[i]; } },
          ve: { rot: "Entrou no bloqueado (R$)", fmt: L.fR, add: function (g, i) { if (L.TIPOS[L.EV.k[i]].s === 1) g.x += L.EV.v[i]; } },
          vs: { rot: "Saiu do bloqueado (R$)", fmt: L.fR, add: function (g, i) { if (L.TIPOS[L.EV.k[i]].s === -1) g.x += L.EV.v[i]; } },
          saldo: { rot: "Entrou − saiu, no livro (R$)", fmt: L.fR, add: function (g, i) { var s = L.TIPOS[L.EV.k[i]].s; g.x += s * L.EV.v[i]; } },
          va: { rot: "Avaria (R$)", fmt: L.fR, add: function (g, i) { if (L.EV.k[i] !== 5) g.x += L.EV.va[i]; } },
          n: { rot: "Movimentos", fmt: L.fInt, add: function (g) { g.x++; } },
          q: { rot: "Quantidade (un.)", fmt: function (v) { return L.fQ(v); }, add: function (g, i) { g.x += L.EV.q[i]; } },
          skus: { rot: "SKUs distintos", fmt: L.fInt, distinto: function (i) { return L.EV.p[i]; } },
        } },
  iv: { rot: "Inventário rotativo (1147)",
        dims: ["resultado", "func", "funcAtu", "filial", "depto", "secao", "fornecedor", "produto", "inventario", "mes", "dia", "dow"],
        medidas: {
          ac: { rot: "Acurácia (%)", fmt: function (v) { return L.fPct(v, 1); }, razao: true, add: function (g, i) { g.d++; if (Math.abs(L.IV.dif[i]) <= 0.0005) g.x++; } },
          abs: { rot: "Divergência: sobra + falta (R$)", fmt: L.fR, add: function (g, i) { g.x += Math.abs(L.IV.vdif[i]); } },
          liq: { rot: "Ajuste líquido (R$)", fmt: L.fR, add: function (g, i) { g.x += L.IV.vdif[i]; } },
          vs: { rot: "Sobra (R$)", fmt: L.fR, add: function (g, i) { if (L.IV.vdif[i] > 0) g.x += L.IV.vdif[i]; } },
          vf: { rot: "Falta (R$)", fmt: L.fR, add: function (g, i) { if (L.IV.vdif[i] < 0) g.x += -L.IV.vdif[i]; } },
          n: { rot: "Contagens", fmt: L.fInt, add: function (g) { g.x++; } },
          div: { rot: "Contagens com diferença", fmt: L.fInt, add: function (g, i) { if (Math.abs(L.IV.dif[i]) > 0.0005) g.x++; } },
          inv: { rot: "Inventários distintos", fmt: L.fInt, distinto: function (i) { return L.IV.i[i]; } },
        } },
  es: { rot: "Estoque bloqueado hoje",
        dims: ["filial", "depto", "secao", "fornecedor", "produto"],
        medidas: {
          vb: { rot: "Bloqueado (R$)", fmt: L.fR, add: function (g, i) { g.x += L.ES.b[i] * L.ES.c[i]; } },
          va: { rot: "Avaria (R$)", fmt: L.fR, add: function (g, i) { g.x += L.ES.a[i] * L.ES.c[i]; } },
          vo: { rot: "Outros bloqueios (R$)", fmt: L.fR, add: function (g, i) { g.x += (L.ES.b[i] - L.ES.a[i]) * L.ES.c[i]; } },
          qb: { rot: "Bloqueado (un.)", fmt: function (v) { return L.fQ(v); }, add: function (g, i) { g.x += L.ES.b[i]; } },
          n: { rot: "Produtos × filial", fmt: L.fInt, add: function (g) { g.x++; } },
        } },
};
var PADRAO = { ev: { linhas: "motivo", colunas: "sentido", medida: "v" }, iv: { linhas: "depto", colunas: "resultado", medida: "abs" }, es: { linhas: "depto", colunas: "filial", medida: "vb" } };

L.registrarPagina({
  id: "analise", grupo: "Análise", menu: "Análise livre", icone: "grade",
  titulo: "Análise livre", olho: "Monte a sua tabela: linhas, colunas e medida",
  filtros: ["filial", "tipo", "motivo", "func", "depto", "fornecedor", "produto"],
  mais: ["rotina", "sentido", "secao", "resultado", "inventario", "dow", "hora"],
  render: render,
});

var ultimo = null;
function render(raiz, params) {
  var cfg = L.estado.analise = Object.assign({ fonte: "ev" }, L.estado.analise || {});
  if (params && params.fonte) { cfg.fonte = params.fonte; if (params.linhas) { cfg.linhas = params.linhas; cfg.colunas = ""; } }
  var F = FONTES[cfg.fonte];
  if (F.dims.indexOf(cfg.linhas) < 0) { cfg.linhas = PADRAO[cfg.fonte].linhas; if (cfg.colunas == null) cfg.colunas = PADRAO[cfg.fonte].colunas; }
  if (cfg.colunas && F.dims.indexOf(cfg.colunas) < 0) cfg.colunas = PADRAO[cfg.fonte].colunas;
  if (cfg.colunas === cfg.linhas) cfg.colunas = "";
  if (!F.medidas[cfg.medida]) cfg.medida = PADRAO[cfg.fonte].medida;
  var mude = function (k, v) { cfg[k] = v; if (k === "fonte") { cfg.linhas = PADRAO[v].linhas; cfg.colunas = PADRAO[v].colunas; cfg.medida = PADRAO[v].medida; } L.sincronizarHash(); L.emitir("filtros"); };

  // ---------------- controles
  var sel = function (rot, chave, opcoes, vazio) {
    var s = L.h("select", { class: "sel", onchange: function () { mude(chave, s.value); } });
    if (vazio) s.appendChild(L.h("option", { value: "", text: vazio }));
    opcoes.forEach(function (o) { var op = L.h("option", { value: o[0], text: o[1] }); if (o[0] === (cfg[chave] || "")) op.selected = true; s.appendChild(op); });
    return L.h("label", { class: "ctl" }, L.h("span", { text: rot }), s);
  };
  var dimsOpc = F.dims.map(function (d) { return [d, L.DIM[d].rot]; });
  var ctl = L.h("div", { class: "analise-ctl painel" },
    sel("Base", "fonte", Object.keys(FONTES).map(function (k) { return [k, FONTES[k].rot]; })),
    sel("Linhas", "linhas", dimsOpc),
    sel("Colunas", "colunas", dimsOpc.filter(function (o) { return o[0] !== cfg.linhas; }), "— nenhuma —"),
    sel("Medida", "medida", Object.keys(F.medidas).map(function (k) { return [k, F.medidas[k].rot]; })),
    L.h("button", { class: "mini-btn", type: "button", html: L.ic("ordem") + " Trocar linhas e colunas", disabled: !cfg.colunas, onclick: function () { var a = cfg.linhas; cfg.linhas = cfg.colunas; cfg.colunas = a; L.sincronizarHash(); L.emitir("filtros"); } }));
  raiz.appendChild(ctl);

  // ---------------- cálculo
  var spec = L.spec(), idx = cfg.fonte === "ev" ? L.filtrarEv(spec) : cfg.fonte === "iv" ? L.filtrarIv(spec) : L.filtrarEs(spec);
  if (cfg.fonte === "ev") { var av = L.avisoSuspeitos(idx); if (av) raiz.insertBefore(av, ctl); }
  var M = F.medidas[cfg.medida], dl = L.DIM[cfg.linhas], dc = cfg.colunas ? L.DIM[cfg.colunas] : null, fx = cfg.fonte;
  var chaveDe = function (d) { return fx === "ev" ? d.ev : fx === "iv" ? d.iv : d.es; };
  var kl = chaveDe(dl), kc = dc ? chaveDe(dc) : null;
  var linhas = new Map(), colTot = new Map(), total = novo();
  function novo() { return { x: 0, d: 0, set: M.distinto ? new Set() : null }; }
  function soma(g, i) { if (M.distinto) g.set.add(M.distinto(i)); else M.add(g, i); }
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], a = kl(i), lin = linhas.get(a);
    if (!lin) { lin = { k: a, tot: novo(), cel: new Map() }; linhas.set(a, lin); }
    soma(lin.tot, i); soma(total, i);
    if (kc) {
      var b = kc(i), cel = lin.cel.get(b); if (!cel) { cel = novo(); lin.cel.set(b, cel); } soma(cel, i);
      var ct = colTot.get(b); if (!ct) { ct = novo(); colTot.set(b, ct); } soma(ct, i);
    }
  }
  var val = function (g) { if (!g) return null; if (M.distinto) return g.set.size; if (M.razao) return g.d ? g.x / g.d : null; return g.x; };
  var ordemNat = ["mes", "dia", "dow", "hora", "sentido", "resultado"].indexOf(cfg.linhas) >= 0;
  var lin = Array.from(linhas.values());
  lin.sort(ordemNat ? function (x, y) { return ordemDim(cfg.linhas, x.k) - ordemDim(cfg.linhas, y.k); } : function (x, y) { return (val(y.tot) || 0) - (val(x.tot) || 0); });
  var cols = Array.from(colTot.keys());
  var ordemColNat = cfg.colunas && ["mes", "dia", "dow", "hora", "sentido", "resultado", "tipo", "filial"].indexOf(cfg.colunas) >= 0;
  cols.sort(ordemColNat ? function (x, y) { return ordemDim(cfg.colunas, x) - ordemDim(cfg.colunas, y); } : function (x, y) { return (val(colTot.get(y)) || 0) - (val(colTot.get(x)) || 0); });
  var maxCols = 24, colsVis = cols.slice(0, maxCols), outrasCols = cols.length - colsVis.length;

  // ---------------- tabela (feita aqui: a de L.tabela não tem colunas dinâmicas com calor)
  var maxCel = 0;
  lin.forEach(function (l) { colsVis.forEach(function (cc) { var v = val(l.cel.get(cc)); if (v != null && Math.abs(v) > maxCel) maxCel = Math.abs(v); }); });
  var limite = 200, pag = L.estado.analiseTudo ? lin.length : Math.min(limite, lin.length);
  var nomeL = function (k) { return L.nomeDe(cfg.linhas, k); }, nomeC = function (k) { return dc.curto ? dc.curto(k) : L.nomeDe(cfg.colunas, k); };
  var tab = L.h("table", { class: "tabela pivo" }), tr = L.h("tr", null, L.h("th", { class: "f1", text: dl.rot }));
  colsVis.forEach(function (cc) { tr.appendChild(L.h("th", { class: "d", text: nomeC(cc), title: L.nomeDe(cfg.colunas, cc) })); });
  if (outrasCols > 0) tr.appendChild(L.h("th", { class: "d", text: "+" + outrasCols + " colunas" }));
  tr.appendChild(L.h("th", { class: "d tot", text: "Total" }));
  tab.appendChild(L.h("thead", null, tr));
  var tb = L.h("tbody");
  lin.slice(0, pag).forEach(function (l) {
    var row = L.h("tr");
    var tdN = L.h("td", { class: "f1" });
    if (cfg.linhas === "produto") { var pi = L.P.i.get(l.k); tdN.appendChild(L.h("span", { class: "cel-foto" }, L.fotoMini(pi), L.h("span", { class: "cel-txt", text: nomeL(l.k) }))); }
    else tdN.textContent = nomeL(l.k);
    tdN.title = nomeL(l.k);
    tdN.addEventListener("click", function (ev) { abrir(cfg, l.k, null, ev); });
    row.appendChild(tdN);
    colsVis.forEach(function (cc) {
      var v = val(l.cel.get(cc)), td = L.h("td", { class: "d num-cel", text: v == null ? "" : M.fmt(v) });
      if (v != null && maxCel) td.style.background = "color-mix(in srgb, var(--ouro) " + Math.round(3 + Math.sqrt(Math.abs(v) / maxCel) * 45) + "%, transparent)";   // raiz: um valor gigante não apaga o resto
      if (v != null) td.addEventListener("click", function (ev) { abrir(cfg, l.k, cc, ev); });
      row.appendChild(td);
    });
    if (outrasCols > 0) row.appendChild(L.h("td", { class: "d" }));
    row.appendChild(L.h("td", { class: "d tot", text: M.fmt(val(l.tot)) }));
    tb.appendChild(row);
  });
  tab.appendChild(tb);
  var tf = L.h("tr", null, L.h("td", { class: "f1", text: "Total" }));
  colsVis.forEach(function (cc) { tf.appendChild(L.h("td", { class: "d", text: M.fmt(val(colTot.get(cc))) })); });
  if (outrasCols > 0) tf.appendChild(L.h("td", { class: "d" }));
  tf.appendChild(L.h("td", { class: "d tot", text: M.fmt(val(total)) }));
  tab.appendChild(L.h("tfoot", null, tf));

  var titulo = M.rot + " por " + dl.rot.toLowerCase() + (dc ? " e " + dc.rot.toLowerCase() : "");
  var acoes = [L.btnPainel("baixar", "Excel", function () { exportar(cfg, titulo, lin, colsVis, val, nomeL, nomeC, M, colTot, total); })];
  var p = L.painel({ titulo: titulo, sub: L.fInt(lin.length) + " linhas · " + FONTES[fx].rot.toLowerCase() + (fx !== "es" ? " · " + L.periodo().rot : "") + " · clique numa célula para abrir o relatório",
                     classe: "c-12", semPad: true, acoes: acoes });
  p.corpo.appendChild(L.h("div", { class: "tb-wrap", style: { maxHeight: "680px" } }, tab));
  if (lin.length > limite) p.corpo.appendChild(L.h("div", { class: "tb-pe" }, L.h("span", { text: L.estado.analiseTudo ? "Mostrando todas as " + L.fInt(lin.length) + " linhas" : "Mostrando as " + limite + " primeiras de " + L.fInt(lin.length) }),
    L.h("button", { class: "mini-btn", type: "button", text: L.estado.analiseTudo ? "Mostrar só 200" : "Mostrar todas", onclick: function () { L.estado.analiseTudo = !L.estado.analiseTudo; L.emitir("filtros"); } })));
  raiz.appendChild(L.grade(p));
  raiz.appendChild(L.nota("Dica: a mesma tabela aceita qualquer combinação. Exemplos: Funcionário × Tipo de movimento (quem faz o quê), Motivo × Mês (o motivo que cresce), Departamento × Resultado da contagem (onde o inventário erra), Fornecedor × Filial no bloqueado de hoje."));
}
function ordemDim(dim, k) {
  if (dim === "dow") return (+k + 6) % 7;                 // segunda primeiro
  if (dim === "sentido") return [1, -1, 0].indexOf(+k);
  if (dim === "resultado") return [-1, 1, 0].indexOf(+k);
  return +k;
}
function abrir(cfg, kl, kc, ev) {
  var f = {}; f[cfg.linhas] = [kl]; if (kc != null && cfg.colunas) f[cfg.colunas] = [kc];
  if (ev && (ev.ctrlKey || ev.metaKey) && L.DIM[cfg.linhas]) { L.alternarFiltro(cfg.linhas, kl); return; }
  var titulo = L.nomeDe(cfg.linhas, kl) + (kc != null && cfg.colunas ? " · " + L.nomeDe(cfg.colunas, kc) : "");
  var simples = kc == null && ["dia", "mes"].indexOf(cfg.linhas) < 0;
  L.abrirDossie(simples ? { dim: cfg.linhas, id: kl, fonte: cfg.fonte } : { fonte: cfg.fonte, f: f, titulo: titulo });
}
function exportar(cfg, titulo, lin, cols, val, nomeL, nomeC, M, colTot, total) {
  var tipo = M.fmt === L.fR ? "moeda" : M.razao ? "percentual" : "inteiro";
  var conv = function (v) { return v == null ? null : M.razao ? v * 100 : v; };
  var colunas = [{ titulo: L.DIM[cfg.linhas].rot, tipo: "texto", valor: function (l) { return nomeL(l.k); } }];
  cols.forEach(function (cc) { colunas.push({ titulo: L.nomeDe(cfg.colunas, cc), tipo: tipo, somar: !M.razao, valor: function (l) { return conv(val(l.cel.get(cc))); } }); });
  colunas.push({ titulo: "Total", tipo: tipo, somar: !M.razao, valor: function (l) { return conv(val(l.tot)); } });
  Planilha.baixar({ arquivo: "analise-livre-" + new Date().toISOString().slice(0, 10) + ".xlsx", titulo: titulo, aba: "Análise", filtros: L.descricaoFiltros([["Base", FONTES[cfg.fonte].rot]], cfg.fonte === "es"), colunas: colunas, linhas: lin });
  L.toast("Planilha gerada: " + L.fInt(lin.length) + " linhas", "ok");
}

})();
