/**
 * /api/dados — entrega o pacote do painel (inventario.painel_cache), já comprimido.
 *
 * A carga (etl/sync_inventario.py) monta o JSON uma vez, comprime em gzip (~1,2 MB) e
 * guarda no banco; esta rota só lê essa linha e devolve os bytes como estão. O navegador
 * descomprime (DecompressionStream) e guarda uma cópia (IndexedDB): na próxima visita,
 * se a versão for a mesma, nem chama esta rota.
 *
 * Por que bytes "crus" (application/octet-stream + X-Pacote: gzip) e não Content-Encoding:
 * o pacote descomprimido passa de 8 MB, acima do limite de resposta das funções da Vercel
 * (4,5 MB). Assim o que trafega é sempre o comprimido, sem depender de ninguém no meio
 * descomprimir ou recomprimir.
 *
 * Se a linha do cache não existir (banco recém-criado), monta na hora com painel_dados().
 * Dado nominal (funcionário, produto, valor): cache só no navegador de quem entrou (private).
 */
"use strict";
const zlib = require("zlib");
const { consultar, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const v = new URL(req.url, "http://x").searchParams.get("v");
    let r = await consultar("SELECT versao, payload_gz FROM inventario.painel_cache WHERE id = 1", []);
    let versao, corpo, origem = "cache";
    if (r.rows[0]) { versao = r.rows[0].versao; corpo = r.rows[0].payload_gz; }
    else {
      r = await consultar("SELECT inventario.painel_dados()::text AS j", []);
      corpo = zlib.gzipSync(Buffer.from(r.rows[0].j, "utf8")); versao = "calculado"; origem = "calculado";
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Pacote", "gzip");
    res.setHeader("X-Versao", versao);
    res.setHeader("X-Painel-Origem", origem);
    res.setHeader("Content-Length", corpo.length);
    // a URL leva a versão: se bater, o navegador pode reaproveitar sem perguntar de novo
    res.setHeader("Cache-Control", v && v === versao ? "private, max-age=31536000, immutable" : "private, no-cache");
    res.end(corpo);
  } catch (e) {
    erroBanco(res, e);
  }
};
