/* =============================================================================
 * app.js — inicialização, menu, rotas, link da visão, busca global, tema, modo
 * apresentação e o botão Atualizar.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var tokRender = 0;

/* ------------------------------ hash (link da visão) ------------------------------ */
function estadoHash() {
  var o = { f: L.estado.filtros, p: L.estado.periodo };
  if (L.estado.medida && L.estado.medida !== "v") o.m = L.estado.medida;
  if (L.estado.suspeitos) o.s = 1;
  if (L.estado.pagina === "analise" && L.estado.analise) o.a = L.estado.analise;
  return "#/" + L.estado.pagina + "?e=" + encodeURIComponent(JSON.stringify(o));
}
L.sincronizarHash = L.debounce(function () { try { history.replaceState(null, "", estadoHash()); } catch (e) {} }, 150);
function lerHash() {
  var m = /^#\/([\w-]+)(?:\?e=(.*))?$/.exec(location.hash || ""), out = { pagina: null, e: null };
  if (!m) return out;
  out.pagina = m[1];
  try { if (m[2]) out.e = JSON.parse(decodeURIComponent(m[2])); } catch (e) {}
  return out;
}

/* ------------------------------ menu ------------------------------ */
function construirMenu() {
  var nav = L.limpar(L.$("menu-itens")), grupos = [], vistos = {};
  L.ordemPaginas.forEach(function (id) { var g = L.paginas[id].grupo; if (!vistos[g]) { vistos[g] = 1; grupos.push(g); } });
  grupos.forEach(function (g) {
    nav.appendChild(L.h("div", { class: "grupo-menu", text: g }));
    L.ordemPaginas.filter(function (id) { return L.paginas[id].grupo === g; }).forEach(function (id) {
      var p = L.paginas[id];
      nav.appendChild(L.h("button", { class: "item-menu", type: "button", "data-p": id, html: L.ic(p.icone) + "<span>" + L.esc(p.menu || p.titulo) + "</span>", onclick: function () { L.irPara(id); document.body.classList.remove("menu-aberto"); } }));
    });
  });
  rodape();
}
function rodape() {
  var M = L.META;
  L.$("menu-rodape").innerHTML =
    '<div><span class="vivo"></span><b>Movimentos até ' + L.esc(M.ult_mov ? L.fDataHora(M.ult_mov) : "—") + "</b></div>" +
    "<div>Último inventário: " + L.esc(M.ult_inv ? L.fDataHora(M.ult_inv) : "—") + "</div>" +
    "<div>Carga de " + L.esc(L.fDataHora(M.carga || M.gerado_em)) + (L.ORIGEM === "copia" ? " · cópia deste computador" : L.ORIGEM === "offline" ? " · <b>sem conexão</b>" : "") + "</div>" +
    "<div>" + L.fInt(L.EV.n) + " movimentos · " + L.fInt(L.IV.n) + " contagens</div>" +
    '<div class="versao">versão ' + L.esc(window.VERSAO || "") + "</div>";
}
function marcarMenu() { document.querySelectorAll(".item-menu").forEach(function (b) { b.classList.toggle("ativo", b.dataset.p === L.estado.pagina); }); }

/* ------------------------------ rotas e renderização ------------------------------ */
L.irPara = function (id, params) {
  if (!L.paginas[id]) return;
  var mudou = L.estado.pagina !== id;
  L.estado.pagina = id; L.estado.params = params || {};
  if (L.dossieAberto && L.dossieAberto()) L.fecharDossie();
  if (mudou) { L.construirFiltros(); marcarMenu(); }
  L.sincronizarHash();
  renderizar();
  window.scrollTo({ top: 0 });
};
function renderizar() {
  if (!L.EV) return;
  var pag = L.paginaAtual(), tok = ++tokRender, cont = L.$("conteudo");
  L.$("titulo").textContent = pag.titulo; L.$("olho").textContent = pag.olho || "";
  document.title = (pag.id === "visao" ? "Visão geral" : pag.titulo) + " — Movimentação de Inventário · Lube";
  L.fila.length = 0;
  var raiz = L.h("div", { class: "pagina" });
  // a tela é montada fora do documento e entra de uma vez (o cálculo leva milissegundos)
  setTimeout(function () {
    if (tok !== tokRender) return;
    try {
      var t0 = performance.now();
      pag.render(raiz, L.estado.params || {});
      L.limpar(cont); cont.appendChild(raiz);
      L.executarFila();
      L.ultimoRenderMs = Math.round(performance.now() - t0);
    } catch (e) {
      console.error(e);
      L.limpar(cont); cont.appendChild(L.erroTela("Não foi possível montar esta tela", (e && e.message) || String(e)));
    }
  }, 0);
}
L.ouvir("filtros", function () { L.atualizarFaixa(); renderizar(); });

/* ------------------------------ busca global ------------------------------ */
function iniciarBusca() {
  var inp = L.$("busca-global"), box = L.$("busca-box"), pop = null;
  var tipos = [["produto", "Produtos"], ["func", "Funcionários"], ["motivo", "Motivos"], ["fornecedor", "Fornecedores"], ["depto", "Departamentos"], ["secao", "Seções"], ["inventario", "Inventários (1147)"]];
  function fechar() { if (pop) { pop.remove(); pop = null; } }
  function buscar() {
    var q = L.norm(inp.value).split(/\s+/).filter(Boolean);
    fechar();
    if (!q.length) return;
    var grupos = [];
    tipos.forEach(function (t) {
      var itens = L.DIM[t[0]].itens(), achou = [];
      for (var i = 0; i < itens.length && achou.length < 6; i++) { var n = itens[i].n; if (q.every(function (x) { return n.indexOf(x) >= 0; })) achou.push(itens[i]); }
      if (achou.length) grupos.push([t, achou]);
    });
    pop = L.h("div", { class: "pop", style: { width: "440px", maxHeight: "72vh" } });
    var lista = L.h("div", { class: "pop-lista" }), primeiro = null;
    if (!grupos.length) lista.appendChild(L.h("div", { class: "pop-vazio", text: "Nada encontrado para “" + inp.value + "”" }));
    grupos.forEach(function (g) {
      lista.appendChild(L.h("div", { class: "grupo-menu", style: { padding: "10px 10px 4px" }, text: g[0][1] }));
      g[1].forEach(function (x) {
        var tx = L.h("span", { class: "tx", title: x.t }); tx.innerHTML = L.destacar(x.t, q);
        var b = L.h("button", { class: "pop-item", type: "button", onclick: function () {
          fechar(); inp.value = ""; inp.blur();
          L.abrirDossie(g[0][0] === "inventario" ? { fonte: "iv", dim: "inventario", id: x.id, periodoLivre: true } : { dim: g[0][0], id: x.id });
        } }, g[0][0] === "produto" ? L.fotoMini(L.P.i.get(x.id)) : null, tx, x.s ? L.h("span", { class: "cn", text: x.s.length > 26 ? x.s.slice(0, 25) + "…" : x.s }) : null);
        if (!primeiro) primeiro = b;
        lista.appendChild(b);
      });
    });
    pop.appendChild(lista); pop._primeiro = primeiro;
    var r = box.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - 448, r.left)) + "px"; pop.style.top = (r.bottom + 6) + "px";
    document.body.appendChild(pop);
  }
  inp.addEventListener("input", L.debounce(buscar, 120));
  inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && pop && pop._primeiro) pop._primeiro.click(); if (ev.key === "Escape") { fechar(); inp.value = ""; inp.blur(); } });
  document.addEventListener("mousedown", function (ev) { if (pop && !pop.contains(ev.target) && !box.contains(ev.target)) fechar(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { ev.preventDefault(); inp.focus(); } });
}

/* ------------------------------ tema, apresentação, link, atualizar ------------------------------ */
function aplicarTema(t) {
  document.documentElement.setAttribute("data-tema", t);
  try { localStorage.setItem("inv-tema", t); } catch (e) {}
  L.estado.tema = t;
  L.$("btn-tema").innerHTML = L.ic(t === "escuro" ? "sol" : "lua");
  setTimeout(L.redesenharTudo, 30);
}
function apresentar(on) {
  L.estado.apresentando = on;
  document.body.classList.toggle("apresentando", on);
  if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(function () {});
  setTimeout(L.redesenharTudo, 120);
}
function navegarPaginas(d) { var i = L.ordemPaginas.indexOf(L.estado.pagina) + d; if (i >= 0 && i < L.ordemPaginas.length) L.irPara(L.ordemPaginas[i]); }
function atualizarDados() {
  var b = L.$("btn-atualizar"); b.classList.add("girando");
  L.versaoNoBanco().then(function (v) {
    if (v.versao !== L.META.versao) { L.toast("Há dados novos (carga das " + L.fDataHora(v.gerado_em) + ") — carregando…", "ok"); setTimeout(function () { location.reload(); }, 700); }
    else { b.classList.remove("girando"); L.toast("Já está na carga mais recente (" + L.fDataHora(v.gerado_em) + "). A próxima carga sai sozinha, no horário agendado.", "ok"); }
  }).catch(function (e) { b.classList.remove("girando"); L.toast("Não foi possível consultar a carga: " + (e.message || e), "erro"); });
}

/* ------------------------------ início ------------------------------ */
function iniciar() {
  L.$("ic-busca").innerHTML = L.ic("busca");
  L.$("btn-menu").innerHTML = L.ic("menu");
  L.$("btn-apresentar").innerHTML = L.ic("maximizar");
  L.$("btn-link").innerHTML = L.ic("link");
  L.$("btn-atualizar").innerHTML = L.ic("relogio");
  aplicarTema(document.documentElement.getAttribute("data-tema") || "escuro");
  L.$("btn-tema").addEventListener("click", function () { aplicarTema(L.estado.tema === "escuro" ? "claro" : "escuro"); });
  L.$("btn-menu").addEventListener("click", function () { document.body.classList.toggle("menu-aberto"); });
  L.$("btn-apresentar").addEventListener("click", function () { apresentar(!L.estado.apresentando); });
  L.$("btn-link").addEventListener("click", function () {
    var url = location.href.split("#")[0] + estadoHash();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { L.toast("Link desta visão copiado (filtros e período juntos)", "ok"); }, function () { L.toast("Não foi possível copiar o link", "erro"); });
  });
  L.$("btn-atualizar").addEventListener("click", atualizarDados);
  document.addEventListener("keydown", function (ev) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if ((ev.key === "f" || ev.key === "F") && !ev.ctrlKey && !ev.metaKey) { if (!L.dossieAberto()) apresentar(!L.estado.apresentando); }
    if (L.estado.apresentando && !L.dossieAberto()) { if (ev.key === "ArrowRight") navegarPaginas(1); if (ev.key === "ArrowLeft") navegarPaginas(-1); }
  });
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && L.estado.apresentando) { L.estado.apresentando = false; document.body.classList.remove("apresentando"); setTimeout(L.redesenharTudo, 120); } });

  var cont = L.$("conteudo"), espera = L.espera("Abrindo a movimentação do galpão…");
  L.limpar(cont).appendChild(espera);
  var aviso = function (t) { var x = espera.querySelector(".espera-txt div"); if (x) x.textContent = t; };
  if (!window.DecompressionStream) { L.limpar(cont).appendChild(L.erroTela("Navegador antigo", "Este painel precisa do Chrome ou do Edge atualizados.")); return; }
  L.carregarTudo(aviso).then(function () {
    construirMenu(); iniciarBusca();
    var h = lerHash();
    L.estado.pagina = h.pagina && L.paginas[h.pagina] ? h.pagina : L.ordemPaginas[0];
    if (h.e) {
      L.estado.filtros = h.e.f || {}; L.estado.periodo = h.e.p || { r: "d30" };
      if (h.e.m) L.estado.medida = h.e.m; if (h.e.s) L.estado.suspeitos = true; if (h.e.a) L.estado.analise = h.e.a;
    }
    L.construirFiltros(); marcarMenu();
    renderizar();
  }).catch(function (e) {
    console.error(e);
    L.limpar(cont).appendChild(L.erroTela("Não foi possível carregar os dados", (e && e.message) || String(e)));
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
