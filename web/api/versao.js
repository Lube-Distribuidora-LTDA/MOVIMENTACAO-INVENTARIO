/**
 * /api/versao — o que há de novo, numa consulta pequena e sem cache:
 *   versao, gerado_em…  o pacote da carga (de 2 em 2 horas); o navegador só baixa /api/dados se mudou
 *   hoje                o pacote do dia, montado pelo AGENTE LUBE (ao vivo); muda a cada gravação
 *   agente              o agente está ligado? (batimento com menos de 3 minutos)
 *   pedido              com ?pedido=<id>: como está o pedido do botão Atualizar
 * O navegador pergunta isto de 15 em 15 segundos com a aba aberta. Sem o schema do agente
 * (banco antigo), responde só o da carga, como antes.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

const SQL_CARGA =
  `SELECT c.versao, c.gerado_em, c.bytes_gz, c.bytes_json,
          (SELECT max(executado_em) FROM inventario.controle_carga WHERE consulta = 'bloqueio' AND status = 'OK') AS carga
     FROM inventario.painel_cache c WHERE c.id = 1`;

const SQL_COMPLETA =
  `SELECT c.versao, c.gerado_em, c.bytes_gz, c.bytes_json,
          (SELECT max(executado_em) FROM inventario.controle_carga WHERE consulta = 'bloqueio' AND status = 'OK') AS carga,
          h.versao AS hoje_versao, h.gerado_em AS hoje_em, h.bytes_json AS hoje_bytes,
          b.visto AS agente_visto, coalesce(b.ligado, false) AS agente_ligado,
          p.id AS pedido_id, p.status AS pedido_status, p.mensagem AS pedido_mensagem, p.detalhe AS pedido_detalhe,
          p.segundos AS pedido_segundos, p.atendido_em AS pedido_atendido_em
     FROM inventario.painel_cache c
     LEFT JOIN inventario.painel_hoje_cache h ON h.id = 1
     LEFT JOIN (SELECT max(visto_em) AS visto, bool_or(ligado) AS ligado FROM agente.batimento
                 WHERE visto_em > now() - interval '3 minutes') b ON true
     LEFT JOIN agente.pedido p ON p.id = $1 AND p.sistema = 'inventario'
    WHERE c.id = 1`;

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const bruto = new URL(req.url, "http://x").searchParams.get("pedido");
    const pedido = /^\d{1,15}$/.test(bruto || "") ? bruto : null;
    let r, completa = true;
    try {
      r = await consultar(SQL_COMPLETA, [pedido]);
    } catch (e) {
      if (!(e && (e.code === "42P01" || e.code === "3F000"))) throw e;
      completa = false;
      r = await consultar(SQL_CARGA, []);
    }
    const l = r.rows[0];
    if (!l) return json(res, 200, { versao: "calculado", gerado_em: null, bytes_gz: null });
    const out = { versao: l.versao, gerado_em: l.gerado_em, bytes_gz: l.bytes_gz, bytes_json: l.bytes_json, carga: l.carga };
    if (completa) {
      out.hoje = l.hoje_versao ? { versao: l.hoje_versao, gerado_em: l.hoje_em, bytes_json: l.hoje_bytes } : null;
      out.agente = { vivo: !!(l.agente_visto && l.agente_ligado), visto_em: l.agente_visto || null };
      if (pedido) {
        out.pedido = l.pedido_id ? { id: Number(l.pedido_id), status: l.pedido_status, mensagem: l.pedido_mensagem,
          detalhe: l.pedido_detalhe, segundos: l.pedido_segundos == null ? null : Number(l.pedido_segundos), atendido_em: l.pedido_atendido_em } : null;
      }
    }
    json(res, 200, out);
  } catch (e) {
    erroBanco(res, e);
  }
};
