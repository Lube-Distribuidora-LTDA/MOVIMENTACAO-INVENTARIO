/**
 * _db.js — conexão com o DATA WAREHOUSE, compartilhada pelas rotas da API
 * (arquivo com "_" no começo não vira rota na Vercel).
 *
 * A senha fica numa variável de ambiente da Vercel e nunca chega ao navegador. As
 * tabelas do schema `inventario` estão com RLS ligado e sem políticas: a chave
 * pública não lê nada; só o ETL e estas funções (credencial de servidor) enxergam.
 *
 * Variáveis (Settings › Environment Variables), cadastradas pelo Júlio:
 *   SUPABASE_DB_HOST      aws-0-sa-east-1.pooler.supabase.com
 *   SUPABASE_DB_PORT      5432   (session pooler; a 6543 conecta e trava neste projeto)
 *   SUPABASE_DB_NAME      postgres
 *   SUPABASE_DB_USER      postgres.ivcnotrynogaljrvvyes
 *   SUPABASE_DB_PASSWORD  a senha do projeto DATA WAREHOUSE
 *
 * Mesmo desenho do REPOSIÇÕES (2026-10-07): sem pool; cada chamada abre a conexão em
 * tentativas escalonadas (se a primeira não respondeu em 4 s, sai outra em paralelo)
 * e a que conectar primeiro vence. O pool do pooler já esgotou uma vez (07/10).
 */
"use strict";
const { Client } = require("pg");
try { require("dns").setDefaultResultOrder("ipv4first"); } catch (_) { /* Node antigo */ }

/* ref do projeto DATA WAREHOUSE: um deploy com variável de outro projeto leria o banco errado sem avisar */
const REF_ESPERADO = "ivcnotrynogaljrvvyes";
const OBRIGATORIAS = ["SUPABASE_DB_HOST", "SUPABASE_DB_USER", "SUPABASE_DB_PASSWORD"];
const ESCALONAR_MS = Number(process.env.DB_ESCALONAR_MS || 4000);
const MAX_TENTATIVAS = Number(process.env.DB_MAX_TENTATIVAS || 3);
const TEMPO_POR_TENTATIVA_MS = Number(process.env.DB_TEMPO_TENTATIVA_MS || 14000);

function configuracao() {
  const usuario = process.env.SUPABASE_DB_USER || "";
  if (!usuario.endsWith(REF_ESPERADO)) throw new Error("SUPABASE_DB_USER aponta para outro projeto (esperado ..." + REF_ESPERADO + ")");
  return {
    host: process.env.SUPABASE_DB_HOST || "aws-0-sa-east-1.pooler.supabase.com",
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    database: process.env.SUPABASE_DB_NAME || "postgres",
    user: usuario,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: TEMPO_POR_TENTATIVA_MS,
    statement_timeout: 40000,
    application_name: "painel-inventario",
  };
}

function conectar() {
  const cfg = configuracao();
  return new Promise((resolve, reject) => {
    let iniciadas = 0, falhas = 0, vencida = false, ultimoErro = null, timer = null;
    function proxima() {
      if (vencida || iniciadas >= MAX_TENTATIVAS) return;
      iniciadas++;
      const c = new Client(cfg);
      c.on("error", () => { /* descartado ou falha tratada abaixo */ });
      c.connect().then(
        () => { if (vencida) { c.end().catch(() => {}); return; } vencida = true; clearTimeout(timer); resolve(c); },
        (e) => {
          ultimoErro = e; falhas++;
          if (vencida) return;
          if (falhas >= MAX_TENTATIVAS) { clearTimeout(timer); reject(ultimoErro); return; }
          if (iniciadas < MAX_TENTATIVAS) { clearTimeout(timer); proxima(); }
        });
      if (iniciadas < MAX_TENTATIVAS) { clearTimeout(timer); timer = setTimeout(proxima, ESCALONAR_MS); }
    }
    proxima();
  });
}

function erroDeConexao(e) { return /timeout|ECONNRESET|ECONNREFUSED|terminated|ETIMEDOUT|EAUTHQUERY|Connection ended/i.test(String((e && e.message) || "")); }

/* roda a consulta numa conexão nova e a encerra; se a conexão morrer no meio, refaz UMA vez */
async function consultar(sql, valores) {
  let ultimoErro;
  for (let i = 0; i < 2; i++) {
    const c = await conectar();
    try { return await c.query(sql, valores); }
    catch (e) { ultimoErro = e; if (!erroDeConexao(e)) throw e; }
    finally { c.end().catch(() => {}); }
  }
  throw ultimoErro;
}

function faltandoVariaveis() { return OBRIGATORIAS.filter((v) => !process.env[v]); }

function json(res, status, obj, cabecalhos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const k in (cabecalhos || {})) res.setHeader(k, cabecalhos[k]);
  res.end(JSON.stringify(obj));
}

/* resposta padrão quando falta variável ou o banco não respondeu (nunca vai para cache) */
function semConfiguracao(res) {
  const faltando = faltandoVariaveis();
  if (!faltando.length) return false;
  json(res, 500, { erro: "configuracao_incompleta", mensagem: "Faltam variáveis de ambiente no projeto da Vercel: " + faltando.join(", ") + ". Cadastre em Settings › Environment Variables e publique de novo." });
  return true;
}
function erroBanco(res, e) {
  console.error("Falha ao consultar o DATA WAREHOUSE:", e && e.message || e);
  json(res, 502, { erro: "falha_no_banco", mensagem: "Não consegui ler o DATA WAREHOUSE agora. Tente de novo em instantes; persistindo, avise o TI.", detalhe: String(e && e.message ? e.message : e) });
}

module.exports = { consultar, faltandoVariaveis, json, semConfiguracao, erroBanco };
