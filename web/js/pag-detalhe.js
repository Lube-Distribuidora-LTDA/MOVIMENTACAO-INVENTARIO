/* =============================================================================
 * pag-detalhe.js — MOVIMENTAÇÕES: todos os movimentos do período, linha a linha,
 * com colunas à escolha, busca, ordenação e Excel com os filtros escritos.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "detalhe", grupo: "Análise", menu: "Movimentações", icone: "tabela",
  titulo: "Movimentações", olho: "Linha a linha, como o WinThor gravou",
  filtros: ["filial", "tipo", "motivo", "func", "depto", "fornecedor", "produto"],
  mais: ["rotina", "sentido", "secao", "dow", "hora"],
  render: render,
});

function render(raiz) {
  var idx = L.filtrarEv(L.spec());
  var aviso = L.avisoSuspeitos(idx); if (aviso) raiz.appendChild(aviso);
  var tab = L.tabelaMov(idx, { titulo: "Movimentações do estoque bloqueado", porPagina: 50, filtrosTexto: function () { return L.descricaoFiltros(); } });
  raiz.appendChild(L.grade(L.painel({ titulo: "Movimentações do estoque bloqueado", sub: L.fInt(idx.length) + " movimentos · " + L.periodo().rot + " · clique numa linha para abrir o relatório do produto", classe: "c-12", semPad: true, corpo: tab })));
  raiz.appendChild(L.nota("Cada linha é um registro do livro de bloqueio do WinThor (PCLOGDESBLOQUEIO), lido conforme o programa que o gravou. Valor = quantidade × custo financeiro de hoje."));
}

})();
