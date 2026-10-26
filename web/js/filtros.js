/* =============================================================================
 * filtros.js — faixa de filtros: período (rápido ou datas livres), filtros de
 * múltipla escolha com busca, pílulas dos filtros ativos e a função única de
 * "mudar filtro" que todo gráfico usa.
 * Regra da casa: a partir de "Todos", o clique seleciona só aquela opção; depois
 * cada clique soma ou tira; esvaziar volta para "Todos" (conjunto vazio = tudo).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var aberto = null;

/* ------------------------------ mudança de filtro ------------------------------ */
var avisar = L.debounce(function () { L.emitir("filtros"); }, 90);
function mudou() { L.sincronizarHash && L.sincronizarHash(); L.atualizarFaixa(); avisar(); }

L.setFiltro = function (chave, ids) {
  if (ids && ids.length) L.estado.filtros[chave] = ids.map(function (x) { return +x; }); else delete L.estado.filtros[chave];
  mudou();
};
L.alternarFiltro = function (chave, id) {
  var a = (L.estado.filtros[chave] || []).slice(), i = a.indexOf(+id);
  if (i >= 0) a.splice(i, 1); else a.push(+id);
  L.setFiltro(chave, a);
};
L.limparFiltros = function () { L.estado.filtros = {}; mudou(); };
L.setPeriodo = function (per) { L.estado.periodo = per; mudou(); };
L.setSuspeitos = function (on) { L.estado.suspeitos = !!on; mudou(); };

/* ------------------------------ popover de opções ------------------------------ */
function fechar() { if (aberto) { aberto.el.remove(); document.removeEventListener("mousedown", aberto.fora, true); document.removeEventListener("keydown", aberto.tecla, true); aberto = null; } }
L.fecharPopover = fechar;
function posicionar(el, ancora, w) {
  document.body.appendChild(el);
  var r = ancora.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px";
  el.style.top = Math.min(r.bottom + 6, innerHeight - 120) + "px";
}
function prender(el, ancora, chave) {
  var fora = function (ev) { if (!el.contains(ev.target) && !ancora.contains(ev.target)) fechar(); };
  var tecla = function (ev) { if (ev.key === "Escape") fechar(); };
  document.addEventListener("mousedown", fora, true); document.addEventListener("keydown", tecla, true);
  aberto = { el: el, chave: chave, fora: fora, tecla: tecla };
}

function abrir(chave, ancora) {
  if (aberto && aberto.chave === chave) return fechar();
  fechar();
  var dim = L.DIM[chave], itens = dim.itens();
  var el = L.h("div", { class: "pop" });
  var inp = L.h("input", { type: "search", placeholder: "Buscar " + dim.rot.toLowerCase() + " por código ou nome…", autocomplete: "off", spellcheck: "false" });
  var lista = L.h("div", { class: "pop-lista" }), rod = L.h("div", { class: "pop-rodape" });
  el.appendChild(L.h("div", { class: "pop-topo" }, inp)); el.appendChild(lista); el.appendChild(rod);
  if (itens.length <= 10) inp.parentNode.style.display = "none";

  function sel() { return L.estado.filtros[chave] || []; }
  function desenhar() {
    var q = L.norm(inp.value).split(/\s+/).filter(Boolean), s = sel(), conj = {}; s.forEach(function (x) { conj[x] = 1; });
    var res = q.length ? itens.filter(function (x) { return q.every(function (t) { return x.n.indexOf(t) >= 0; }); }) : itens;
    var marc = [], resto = [];
    res.forEach(function (x) { (conj[x.id] ? marc : resto).push(x); });
    var ordenado = marc.concat(resto), limite = 160, mostrar = ordenado.slice(0, limite);
    L.limpar(lista);
    if (!mostrar.length) lista.appendChild(L.h("div", { class: "pop-vazio", text: "Nada encontrado" }));
    mostrar.forEach(function (x) {
      var tx = L.h("span", { class: "tx", title: x.t });
      tx.innerHTML = destacar(x.t, q);
      lista.appendChild(L.h("button", { class: "pop-item" + (conj[x.id] ? " on" : ""), type: "button", onclick: function () { L.alternarFiltro(chave, x.id); desenhar(); } },
        L.h("span", { class: "cx" }), tx, x.s ? L.h("span", { class: "cn", text: x.s.length > 24 ? x.s.slice(0, 23) + "…" : x.s }) : null));
    });
    if (ordenado.length > limite) lista.appendChild(L.h("div", { class: "pop-vazio", text: "+ " + L.fInt(ordenado.length - limite) + " resultados — refine a busca" }));
    L.limpar(rod);
    rod.appendChild(L.h("span", { text: s.length ? s.length + " selecionado" + (s.length > 1 ? "s" : "") : "Todos" }));
    var acoes = L.h("span", { style: { display: "flex", gap: "6px" } });
    if (q.length && res.length > 1 && res.length <= 300) acoes.appendChild(L.h("button", { class: "mini-btn", type: "button", text: "Marcar os " + res.length, onclick: function () { var a = sel().slice(); res.forEach(function (x) { if (a.indexOf(x.id) < 0) a.push(x.id); }); L.setFiltro(chave, a); desenhar(); } }));
    acoes.appendChild(L.h("button", { class: "mini-btn", type: "button", text: "Limpar", onclick: function () { L.setFiltro(chave, []); desenhar(); } }));
    rod.appendChild(acoes);
  }
  inp.addEventListener("input", desenhar);
  posicionar(el, ancora, 340);
  desenhar();
  setTimeout(function () { inp.focus(); }, 30);
  prender(el, ancora, chave);
}
/* busca fácil por código ou nome, com o trecho achado destacado */
function destacar(texto, termos) {
  var s = L.esc(texto);
  if (!termos.length) return s;
  var n = L.norm(texto), marcas = [];
  termos.forEach(function (t) { var i = n.indexOf(t); if (i >= 0) marcas.push([i, i + t.length]); });
  if (!marcas.length) return s;
  marcas.sort(function (a, b) { return a[0] - b[0]; });
  var out = "", pos = 0;
  marcas.forEach(function (m) { if (m[0] < pos) return; out += L.esc(texto.slice(pos, m[0])) + "<mark>" + L.esc(texto.slice(m[0], m[1])) + "</mark>"; pos = m[1]; });
  return out + L.esc(texto.slice(pos));
}
L.destacar = destacar;

/* datas livres */
function abrirDatas(ancora) {
  if (aberto && aberto.chave === "_datas") return fechar();
  fechar();
  var p = L.periodo();
  var de = L.h("input", { type: "date", value: L.isoDeDia(p.de) }), ate = L.h("input", { type: "date", value: L.isoDeDia(p.ate) });
  // o "de" passou do "até"? o outro acompanha, em vez de trocar os dois de lugar
  de.addEventListener("change", function () { if (de.value && ate.value && de.value > ate.value) ate.value = de.value; });
  ate.addEventListener("change", function () { if (de.value && ate.value && ate.value < de.value) de.value = ate.value; });
  var el = L.h("div", { class: "pop pop-datas" },
    L.h("div", { class: "pop-lista" },
      L.h("label", { class: "campo-data" }, L.h("span", { text: "De" }), de),
      L.h("label", { class: "campo-data" }, L.h("span", { text: "Até" }), ate),
      L.h("div", { class: "atalhos-mes" }, ultimosMeses().map(function (m) {
        return L.h("button", { class: "mini-btn", type: "button", text: L.fMesK(m.k), onclick: function () { de.value = L.isoDeDia(m.de); ate.value = L.isoDeDia(m.ate); } });
      }))),
    L.h("div", { class: "pop-rodape" }, L.h("span", { text: "Escolha um intervalo" }),
      L.h("button", { class: "btn pri", type: "button", style: { height: "34px" }, text: "Aplicar", onclick: function () { if (!de.value || !ate.value) return; fechar(); L.setPeriodo({ r: "livre", de: de.value, ate: ate.value }); } })));
  posicionar(el, ancora, 330);
  prender(el, ancora, "_datas");
}
function ultimosMeses() {
  var out = [], d = L.hojeDia();
  for (var i = 0; i < 6; i++) { var ini = L.primeiroDoMes(L.somarMeses(d, -i)); out.push({ k: L.mesDeDia(ini), de: ini, ate: Math.min(L.ultimoDoMes(ini), L.hojeDia()) }); }
  return out;
}

function menuMais(lista, ancora) {
  fechar();
  var el = L.h("div", { class: "pop", style: { width: "260px" } }), corpo = L.h("div", { class: "pop-lista" });
  lista.forEach(function (k) {
    var n = (L.estado.filtros[k] || []).length;
    corpo.appendChild(L.h("button", { class: "pop-item" + (n ? " on" : ""), type: "button", onclick: function () { fechar(); abrir(k, ancora); } },
      L.h("span", { class: "tx", text: L.DIM[k].rot }), n ? L.h("span", { class: "cn", text: n + " sel." }) : null));
  });
  el.appendChild(corpo);
  posicionar(el, ancora, 260);
  prender(el, ancora, "_mais");
}

/* ------------------------------ faixa ------------------------------ */
L.construirFiltros = function () {
  var pag = L.paginaAtual(), box = L.$("faixa-filtros");
  L.limpar(box);
  box.dataset.pagina = pag.id;
  box.appendChild(L.h("span", { class: "fx-rot", html: L.ic("filtro") + " Filtros" }));
  if (!pag.semPeriodo) {
    var seg = L.h("div", { class: "seg", id: "fx-rapido" });
    L.RAPIDOS.forEach(function (r) { seg.appendChild(L.h("button", { type: "button", "data-r": r[0], text: r[1], onclick: function () { L.setPeriodo({ r: r[0] }); } })); });
    box.appendChild(seg);
    box.appendChild(L.h("button", { class: "fx-btn fx-datas", type: "button", id: "fx-datas", onclick: function (ev) { abrirDatas(ev.currentTarget); } }, L.icEl("calendario"), L.h("span", { class: "rot-per" })));
  } else {
    box.appendChild(L.h("span", { class: "fx-hoje", html: L.ic("relogio") + (L.AO_VIVO
      ? " Posição de hoje · do WinThor às " + L.esc(new Date(L.META.ao_vivo).toLocaleTimeString("pt-BR"))
      : " Posição de hoje · carga de " + L.esc(L.fDataHora(L.META.carga || L.META.gerado_em))) }));
  }
  (pag.filtros || []).forEach(function (chave) {
    box.appendChild(L.h("button", { class: "fx-btn", type: "button", "data-k": chave, onclick: function (ev) { abrir(chave, ev.currentTarget); } },
      L.h("span", { text: L.DIM[chave].rot }), L.h("span", { class: "n", hidden: true }), L.icEl("baixo")));
  });
  if ((pag.mais || []).length) box.appendChild(L.h("button", { class: "fx-btn fx-mais", type: "button", onclick: function (ev) { menuMais(pag.mais, ev.currentTarget); } },
    L.h("span", { text: "Mais filtros" }), L.h("span", { class: "n", hidden: true }), L.icEl("baixo")));
  box.appendChild(L.h("button", { class: "fx-limpar", type: "button", text: "Limpar filtros", onclick: function () { L.limparFiltros(); L.toast("Filtros limpos (o período continua)"); } }));
  box.appendChild(L.h("div", { class: "fx-pilulas", id: "fx-pilulas" }));
  L.atualizarFaixa();
};

L.atualizarFaixa = function () {
  var box = L.$("faixa-filtros"); if (!box || !box.dataset.pagina) return;
  var pag = L.paginaAtual(), f = L.estado.filtros, visiveis = (pag.filtros || []).concat(pag.mais || []);
  box.querySelectorAll(".fx-btn[data-k]").forEach(function (b) {
    var a = f[b.dataset.k] || [], n = b.querySelector(".n");
    b.classList.toggle("on", a.length > 0); n.hidden = !a.length; n.textContent = a.length;
  });
  var bm = box.querySelector(".fx-mais");
  if (bm) { var nm = (pag.mais || []).reduce(function (s, k) { return s + (f[k] || []).length; }, 0), nn = bm.querySelector(".n"); bm.classList.toggle("on", nm > 0); nn.hidden = !nm; nn.textContent = nm; }
  var rap = box.querySelector("#fx-rapido"), per = L.estado.periodo || {};
  if (rap) rap.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.r === per.r); });
  var bd = box.querySelector("#fx-datas");
  if (bd) { var p = L.periodo(); bd.querySelector(".rot-per").textContent = p.de === p.ate ? L.fDia(p.de) : L.fDia(p.de) + " – " + L.fDia(p.ate); bd.classList.toggle("on", per.r === "livre"); }
  var pil = L.$("fx-pilulas"); if (!pil) return;
  L.limpar(pil);
  var qtd = 0;
  Object.keys(f).forEach(function (k) {
    if (!L.DIM[k]) return;
    (f[k] || []).forEach(function (id) {
      qtd++;
      var fora = visiveis.indexOf(k) < 0;           // filtro que não vale nesta tela: fica, mas apagado
      pil.appendChild(pilula(L.DIM[k].rot, L.nomeDe(k, id), function () { L.alternarFiltro(k, id); }, fora));
    });
  });
  if (L.estado.suspeitos) { qtd++; pil.appendChild(pilula("Somas", "com movimentos suspeitos", function () { L.setSuspeitos(false); })); }
  pil.style.display = qtd ? "" : "none";
  var nl = box.querySelector(".fx-limpar"); if (nl) nl.style.display = Object.keys(f).length ? "" : "none";
};
function pilula(rot, texto, aoRemover, fora) {
  return L.h("span", { class: "pilula" + (fora ? " fora" : ""), title: fora ? "Este filtro não se aplica a esta tela" : null }, L.h("b", { text: rot }), L.h("span", { text: texto, title: texto }),
    L.h("button", { type: "button", title: "Remover", html: L.ic("x"), onclick: aoRemover }));
}

})();
