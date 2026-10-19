/**
 * /api/img?cod=<código> — foto do produto em miniatura (WebP, 288 px).
 *
 * A foto não é deste sistema: é a miniatura que o Gestão Comercial (Trade) já guarda em
 * trade.produto_miniatura, a partir da pasta FOTOS_ION. Aqui só se LÊ (cruzar schemas na
 * leitura é permitido pelo padrão do DATA WAREHOUSE); quem mantém a foto é a carga do Trade.
 * Atrás do guarda da Sentinela, como o resto. Cache só no navegador de quem entrou.
 */
"use strict";
const { consultar, json, semConfiguracao } = require("./_db");

const recentes = new Map();            // cod -> { webp, ate }: a miniatura quase não muda
const VALIDADE_MS = 10 * 60 * 1000, MAX_RECENTES = 300;

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  const cod = Number(new URL(req.url, "http://x").searchParams.get("cod"));
  if (!Number.isInteger(cod) || cod <= 0 || cod > 999999999) return json(res, 404, { erro: "foto não encontrada" });
  try {
    let hit = recentes.get(cod);
    if (!hit || hit.ate < Date.now()) {
      const r = await consultar("SELECT webp FROM trade.produto_miniatura WHERE codprod = $1", [cod]);
      hit = { webp: r.rows[0] ? r.rows[0].webp : null, ate: Date.now() + VALIDADE_MS };
      recentes.set(cod, hit);
      if (recentes.size > MAX_RECENTES) recentes.delete(recentes.keys().next().value);
    }
    if (!hit.webp) { res.statusCode = 404; res.setHeader("Cache-Control", "private, max-age=300"); return res.end(); }
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(hit.webp);
  } catch (e) {
    console.error("[img]", e && e.message || e);
    json(res, 503, { erro: "foto indisponível agora" });
  }
};
