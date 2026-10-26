/**
 * /api/hoje — o pacote do dia, ao vivo (inventario.painel_hoje_cache), comprimido.
 *
 * Quem monta é o AGENTE LUBE: ele lê o WinThor de segundos em segundos e, depois de
 * gravar, roda inventario.atualizar_painel_hoje() (agente.sistema.apos_gravar). O
 * navegador soma este pacote ao da carga (/api/dados, de 2 em 2 horas): de ontem em
 * diante vale o do dia. Mesmo formato de entrega do /api/dados (bytes gzip crus).
 *
 * O banco guarda texto (o Postgres não tem gzip; o TOAST comprime no disco): a
 * compressão é aqui, ~480 KB viram ~100 KB. Sem o pacote (agente nunca rodou), 404.
 * Dado nominal: cache só no navegador de quem entrou (private).
 */
"use strict";
const zlib = require("zlib");
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const v = new URL(req.url, "http://x").searchParams.get("v");
    let r;
    try {
      r = await consultar("SELECT versao, payload FROM inventario.painel_hoje_cache WHERE id = 1", []);
    } catch (e) {
      if (e && e.code === "42P01") return json(res, 404, { erro: "sem_pacote_do_dia", mensagem: "O pacote do dia ainda não existe neste banco." });
      throw e;
    }
    const l = r.rows[0];
    if (!l) return json(res, 404, { erro: "sem_pacote_do_dia", mensagem: "O agente ainda não montou o pacote do dia." });
    const corpo = zlib.gzipSync(Buffer.from(l.payload, "utf8"), { level: 6 });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Pacote", "gzip");
    res.setHeader("X-Versao", l.versao);
    res.setHeader("Content-Length", corpo.length);
    // a URL leva a versão: se bater, o navegador pode reaproveitar sem perguntar de novo
    res.setHeader("Cache-Control", v && v === l.versao ? "private, max-age=31536000, immutable" : "private, no-cache");
    res.end(corpo);
  } catch (e) {
    erroBanco(res, e);
  }
};
