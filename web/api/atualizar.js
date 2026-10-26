/**
 * /api/atualizar (POST) — o botão Atualizar pede ao AGENTE LUBE uma leitura do WinThor agora.
 *
 * A ponte é o próprio banco: agente.pedir_atualizacao() grava o pedido e avisa por NOTIFY;
 * o agente, na SRV-IA, escuta na conexão que já mantém aberta para fora, lê o WinThor na
 * hora, monta o pacote do dia e responde no pedido (agente.pedido). Nenhuma porta aberta na
 * rede da Lube, e o painel nunca chega no Oracle. O navegador acompanha por
 * /api/versao?pedido=<id>.
 *
 * Dez cliques seguidos viram uma leitura só (o pedido aberto serve para todos). Com o agente
 * fora do ar (batimento com mais de 3 minutos), nada é pedido: a resposta diz isso e o
 * navegador cai no jeito antigo (conferir a carga agendada, às 07:05).
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { erro: "metodo", mensagem: "Use POST." }, { Allow: "POST" });
  if (semConfiguracao(res)) return;
  try {
    let r;
    try {
      r = await consultar(
        `WITH a AS (SELECT max(visto_em) AS visto, bool_or(ligado) AS ligado FROM agente.batimento WHERE visto_em > now() - interval '3 minutes')
         SELECT a.visto, coalesce(a.ligado, false) AS ligado,
                CASE WHEN a.visto IS NOT NULL AND a.ligado THEN agente.pedir_atualizacao('inventario', 'painel movimentacao-inventario') END AS pedido
           FROM a`, []);
    } catch (e) {
      if (e && (e.code === "42P01" || e.code === "3F000" || e.code === "42883")) {
        return json(res, 200, { agente: false, mensagem: "O agente do WinThor ainda não foi instalado." });
      }
      throw e;
    }
    const l = r.rows[0] || {};
    if (!l.pedido) {
      return json(res, 200, { agente: false, visto_em: l.visto || null,
        mensagem: l.visto ? "O agente do WinThor está em pausa." : "O agente do WinThor não está ligado agora." });
    }
    json(res, 200, { agente: true, pedido: Number(l.pedido) });
  } catch (e) {
    erroBanco(res, e);
  }
};
