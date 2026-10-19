/**
 * /api/versao — qual pacote está no banco (versão, hora e tamanho). Pequena e sem cache:
 * o navegador pergunta isto ao abrir e só baixa /api/dados se a versão mudou.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const r = await consultar(
      `SELECT c.versao, c.gerado_em, c.bytes_gz, c.bytes_json,
              (SELECT max(executado_em) FROM inventario.controle_carga WHERE consulta = 'bloqueio' AND status = 'OK') AS carga
         FROM inventario.painel_cache c WHERE c.id = 1`, []);
    const l = r.rows[0];
    if (!l) return json(res, 200, { versao: "calculado", gerado_em: null, bytes_gz: null });
    json(res, 200, { versao: l.versao, gerado_em: l.gerado_em, bytes_gz: l.bytes_gz, bytes_json: l.bytes_json, carga: l.carga });
  } catch (e) {
    erroBanco(res, e);
  }
};
