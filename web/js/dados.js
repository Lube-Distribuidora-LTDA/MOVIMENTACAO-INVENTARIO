/* =============================================================================
 * dados.js — o motor do navegador.
 *
 * O pacote do painel (inventario.painel_dados(), comprimido pela carga) chega uma
 * vez, fica guardado no navegador (IndexedDB) e daí em diante TODO filtro, soma e
 * comparação é feito aqui, em arrays tipados: ~200 mil movimentos filtram em poucos
 * milissegundos. Abre na hora: se a versão guardada é a mesma do banco, nem baixa.
 *
 * Estruturas (todas em L):
 *   L.P  produtos      L.EV movimentos do bloqueado (266 e companhia)
 *   L.IV inventário rotativo (1147)      L.ES posição de hoje (PCEST)
 * Datas: "dia" = dias desde L.META.base (UTC, sem fuso); "t" = minutos desde a base.
 * Filtros guardam CÓDIGOS (codprod, matrícula, coddevol...), nunca índices: um link
 * copiado continua valendo depois de uma carga nova.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ tipos de movimento ------------------------------ */
/* s: +1 entra no bloqueado, −1 sai, 0 neutro. g: grupo de origem (dimensão "Rotina").
   O recebimento (13) vem do PCMOV, não do livro da 266: o WinThor grava quanto entrou
   bloqueado na própria linha da nota (QTBLOQUEADA). O estorno do cancelamento (14) é neutro
   (tira do bloqueado só se a mercadoria ainda não tinha sido liberada); a parte que entrou
   livre (15) também. */
L.TIPOS = [
  { id: 0,  nome: "Outro",                          curto: "Outro",           s: 0,  g: 6, cor: "--d8" },
  { id: 1,  nome: "Bloqueio manual",                curto: "Bloqueio",        s: 1,  g: 0, cor: "--d1" },
  { id: 2,  nome: "Bloqueio por avaria",            curto: "Bloq. avaria",    s: 1,  g: 0, cor: "--d5" },
  { id: 3,  nome: "Avaria registrada",              curto: "Avaria",          s: 0,  g: 0, cor: "--d7" },
  { id: 4,  nome: "Desbloqueio manual",             curto: "Desbloqueio",     s: -1, g: 0, cor: "--d4" },
  { id: 5,  nome: "Baixa de avaria",                curto: "Baixa avaria",    s: -1, g: 0, cor: "--d3" },
  { id: 6,  nome: "Liberação pelo WMS",             curto: "Liberação WMS",   s: -1, g: 1, cor: "--d2" },
  { id: 7,  nome: "Devolução de cliente",           curto: "Devolução",       s: 1,  g: 2, cor: "--d6" },
  { id: 8,  nome: "Devolução cancelada",            curto: "Dev. cancelada",  s: 0,  g: 3, cor: "--d8" },
  { id: 9,  nome: "Desbloqueio automático",         curto: "Desbl. autom.",   s: -1, g: 4, cor: "--d4" },
  { id: 10, nome: "Montagem de produtos",           curto: "Montagem",        s: 1,  g: 5, cor: "--d8" },
  { id: 11, nome: "Devolução avulsa",               curto: "Dev. avulsa",     s: 1,  g: 2, cor: "--d6" },
  { id: 12, nome: "Devolução de simples remessa",   curto: "Dev. s. remessa", s: 1,  g: 2, cor: "--d6" },
  { id: 13, nome: "Recebimento de compra",          curto: "Recebimento",     s: 1,  g: 7, cor: "--d9" },
  { id: 14, nome: "Recebimento cancelado",          curto: "Receb. cancelado", s: 0, g: 7, cor: "--d8" },
  { id: 15, nome: "Recebimento sem bloqueio",       curto: "Receb. livre",    s: 0,  g: 7, cor: "--d7" },
];
L.ROTINAS = [
  { id: 0, nome: "266 · Bloqueio de estoque" },
  { id: 1, nome: "WMS Kaizen · armazenagem" },
  { id: 2, nome: "1303/1346 · Devolução de cliente" },
  { id: 3, nome: "1316 · Cancelamento de devolução" },
  { id: 4, nome: "552 · Desbloqueio automático" },
  { id: 5, nome: "1122 · Montagem de produtos" },
  { id: 6, nome: "Outros programas" },
  { id: 7, nome: "1301 · Recebimento de compra" },
];
L.SENTIDOS = [{ id: 1, nome: "Entrou no bloqueado" }, { id: -1, nome: "Saiu do bloqueado" }, { id: 0, nome: "Neutro (não muda o saldo)" }];
L.DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
L.DS3 = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
L.RESULTADOS = [{ id: 1, nome: "Sobra (contou mais)" }, { id: -1, nome: "Falta (contou menos)" }, { id: 0, nome: "Sem divergência" }];
/* um movimento acima disto, num registro só, é erro de digitação no WinThor (o caso real:
   recebimento de 17 paletes lançado com 17.000.000 bloqueados em 27/06/2025 e desbloqueado
   em 04/07/2025). Fica fora das somas, com aviso na tela. */
L.LIMITE_SUSPEITO = 1000000;
L.corTipo = function (k) { return L.cssVar(L.TIPOS[k] ? L.TIPOS[k].cor : "--d8"); };

/* ------------------------------ datas (sem fuso: tudo em UTC) ------------------------------ */
var BASE = 0;
L.isoDeDia = function (d) { return new Date(BASE + d * 864e5).toISOString().slice(0, 10); };
L.diaDeIso = function (iso) { return Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - BASE) / 864e5); };
L.dataDeT = function (t) { return new Date(BASE + t * 60000); };
L.fDia = function (d) { return L.fData(L.isoDeDia(d)); };
L.fDiaCurto = function (d) { var s = L.isoDeDia(d); return s.slice(8, 10) + "/" + s.slice(5, 7); };
L.fT = function (t) { var x = L.dataDeT(t); return x.toISOString().slice(8, 10) + "/" + x.toISOString().slice(5, 7) + "/" + x.getUTCFullYear() + " " + x.toISOString().slice(11, 16); };
L.fHora = function (t) { return L.dataDeT(t).toISOString().slice(11, 16); };
L.mesDeDia = function (d) { var s = L.isoDeDia(d); return +s.slice(0, 4) * 100 + +s.slice(5, 7); };   // 202610
L.fMesK = function (k) { return L.MES3[k % 100 - 1] + "/" + String(Math.floor(k / 100)).slice(2); };
L.fMesKLongo = function (k) { return L.MESES[k % 100 - 1] + "/" + Math.floor(k / 100); };
L.hojeDia = function () { var n = new Date(); return Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - BASE) / 864e5); };
function primeiroDoMes(d) { var s = L.isoDeDia(d); return L.diaDeIso(s.slice(0, 8) + "01"); }
function ultimoDoMes(d) { var s = L.isoDeDia(d), y = +s.slice(0, 4), m = +s.slice(5, 7); return L.diaDeIso(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); }
function somarMeses(d, n) {                       // mesmo dia, n meses depois (limita ao fim do mês)
  var s = L.isoDeDia(d), y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n, dia = +s.slice(8, 10);
  var yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, fim = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return L.diaDeIso(new Date(Date.UTC(yy, mm, Math.min(dia, fim))).toISOString().slice(0, 10));
}
L.somarMeses = somarMeses; L.primeiroDoMes = primeiroDoMes; L.ultimoDoMes = ultimoDoMes;

/* ------------------------------ carga do pacote ------------------------------ */
var IDB = "inventario-lube", LOJA = "pacote";
function idbAbrir() {
  return new Promise(function (ok, erro) {
    if (!window.indexedDB) return erro(new Error("sem IndexedDB"));
    var r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = function () { r.result.createObjectStore(LOJA); };
    r.onsuccess = function () { ok(r.result); }; r.onerror = function () { erro(r.error); };
  });
}
function idbLer() {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var q = db.transaction(LOJA, "readonly").objectStore(LOJA).get("atual");
    q.onsuccess = function () { ok(q.result || null); }; q.onerror = function () { ok(null); };
  }); }).catch(function () { return null; });
}
function idbGravar(obj) {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var tx = db.transaction(LOJA, "readwrite"); tx.objectStore(LOJA).put(obj, "atual");
    tx.oncomplete = function () { ok(true); }; tx.onerror = function () { ok(false); };
  }); }).catch(function () { return false; });
}
function erroHttp(r, oque) {
  return r.json().catch(function () { return {}; }).then(function (j) {
    if (r.status === 401) throw new Error("Sua sessão do Painel Lube expirou. Entre de novo pelo portal.");
    throw new Error("Não foi possível ler " + oque + " (" + r.status + (j && j.mensagem ? ": " + j.mensagem : j && j.erro ? ": " + j.erro : "") + ").");
  });
}
function baixarPacote(versao, aoProgresso) {
  return fetch("api/dados?v=" + encodeURIComponent(versao || "x"), { cache: "no-store" }).then(function (r) {
    if (!r.ok) return erroHttp(r, "o pacote de dados");
    var total = +(r.headers.get("Content-Length") || 0), lido = 0;
    var corpo = r.body;
    if (aoProgresso && corpo && corpo.getReader) {
      corpo = corpo.pipeThrough(new TransformStream({ transform: function (ch, ctl) { lido += ch.byteLength; aoProgresso(lido, total); ctl.enqueue(ch); } }));
    }
    if (r.headers.get("X-Pacote") === "gzip" && window.DecompressionStream) corpo = corpo.pipeThrough(new DecompressionStream("gzip"));
    return new Response(corpo).text();
  }).then(function (txt) { return JSON.parse(txt); });
}

/* Abre o painel: cópia do navegador primeiro (se for a versão do banco, nem baixa). */
L.carregarTudo = function (aoAviso) {
  var aviso = aoAviso || function () {};
  return Promise.all([
    fetch("api/versao?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : erroHttp(r, "a versão dos dados"); }),
    idbLer(),
  ]).then(function (r) {
    var ver = r[0], copia = r[1];
    if (copia && copia.versao === ver.versao) { L.ORIGEM = "copia"; return preparar(copia.pacote, ver.versao); }
    aviso(copia ? "Baixando os dados da carga das " + L.fDataHora(ver.gerado_em) + "…" : "Baixando os dados (só na primeira vez)…");
    return baixarPacote(ver.versao, function (l, t) { aviso("Baixando os dados… " + (t ? Math.round(l / t * 100) + "%" : L.fNum(l / 1048576, 1) + " MB")); })
      .then(function (pac) { L.ORIGEM = "banco"; idbGravar({ versao: ver.versao, pacote: pac }); return preparar(pac, ver.versao); });
  }, function (e) {
    // sem o servidor: abre com a cópia guardada, avisando
    return idbLer().then(function (copia) {
      if (!copia) throw e;
      L.ORIGEM = "offline"; L.toast("Sem conexão com o servidor: mostrando os dados guardados neste computador", "erro");
      return preparar(copia.pacote, copia.versao);
    });
  });
};
/* versão nova no banco? (botão Atualizar) */
L.versaoNoBanco = function () { return fetch("api/versao?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : erroHttp(r, "a versão dos dados"); }); };

/* ------------------------------ preparo das estruturas ------------------------------ */
function idx(lista) { var m = new Map(); lista.forEach(function (x, i) { m.set(x[0], i); }); return m; }

function preparar(J, versao) {
  var M = L.META = J.meta; M.versao = versao;
  BASE = Date.UTC(+M.base.slice(0, 4), +M.base.slice(5, 7) - 1, +M.base.slice(8, 10));
  L.BASE_DOW = new Date(BASE).getUTCDay();

  // ---- cadastros
  var D = L.D = { filiais: J.filiais, motivos: J.motivos, funcs: J.funcs, fornecedores: J.fornecedores, deptos: J.deptos, secoes: J.secoes };
  D.iFil = idx(J.filiais); D.iMot = idx(J.motivos); D.iFun = idx(J.funcs); D.iFor = idx(J.fornecedores); D.iDep = idx(J.deptos); D.iSec = idx(J.secoes);
  var fotos = new Set(J.fotos || []);
  var nP = J.produtos.length;
  var P = L.P = { n: nP, cod: new Int32Array(nP), desc: new Array(nP), emb: new Array(nP), un: new Array(nP),
                  forn: new Int32Array(nP), dep: new Int32Array(nP), sec: new Int32Array(nP), fl: new Uint8Array(nP), foto: new Uint8Array(nP), i: new Map() };
  J.produtos.forEach(function (r, i) {
    P.cod[i] = r[0]; P.desc[i] = r[1] || ("Produto " + r[0]); P.emb[i] = r[2] || ""; P.un[i] = r[6] || "";
    P.forn[i] = r[3]; P.dep[i] = r[4]; P.sec[i] = r[5]; P.fl[i] = r[7]; P.foto[i] = fotos.has(r[0]) ? 1 : 0; P.i.set(r[0], i);
  });
  var pIdx = function (cod) { var i = P.i.get(cod); return i == null ? -1 : i; };

  // ---- posição de hoje (e o custo que valoriza o resto)
  var S = J.est, nS = S.n;
  var ES = L.ES = { n: nS, f: new Int16Array(nS), p: new Int32Array(nS), e: Float64Array.from(S.e), b: Float64Array.from(S.b), a: Float64Array.from(S.a),
                    r: Float64Array.from(S.r), c: Float64Array.from(S.c), ue: new Int32Array(nS), ultBloq: new Int32Array(nS).fill(-1), motUlt: new Int32Array(nS).fill(-1) };
  var custo = new Map(), chaveFP = function (fil, p) { return fil * 1000000 + p; }, posDe = new Map();
  for (var s = 0; s < nS; s++) {
    ES.f[s] = S.f[s]; ES.p[s] = pIdx(S.p[s]); ES.ue[s] = S.ue[s] == null ? -1 : S.ue[s];
    custo.set(chaveFP(S.f[s], ES.p[s]), ES.c[s]); posDe.set(chaveFP(S.f[s], ES.p[s]), s);
  }
  L.custoDe = function (fil, p) { var c = custo.get(chaveFP(fil, p)); return c == null ? 0 : c; };
  L.posicaoDe = function (fil, p) { var s = posDe.get(chaveFP(fil, p)); return s == null ? -1 : s; };

  // ---- movimentos
  var E = J.ev, n = E.n;
  var EV = L.EV = { n: n, t: new Int32Array(n), dia: new Int32Array(n), f: new Int16Array(n), p: new Int32Array(n), u: new Int16Array(n), m: new Int16Array(n),
                    k: new Int8Array(n), q: Float64Array.from(E.q), a: Float64Array.from(E.a), d: Float64Array.from(E.d), v: new Float64Array(n), va: new Float64Array(n),
                    sus: new Uint8Array(n), semCusto: 0, nSus: 0 };
  var t = 0;
  for (var i = 0; i < n; i++) {
    t += E.dt[i];
    EV.t[i] = t; EV.dia[i] = Math.floor(t / 1440);
    EV.f[i] = E.f[i]; EV.p[i] = pIdx(E.p[i]);
    var u = D.iFun.get(E.u[i]); EV.u[i] = u == null ? -1 : u;
    var mm = D.iMot.get(E.m[i]); EV.m[i] = mm == null ? -1 : mm;
    EV.k[i] = E.k[i];
    var c = L.custoDe(E.f[i], EV.p[i]);
    if (!c) EV.semCusto++;
    EV.v[i] = EV.q[i] * c; EV.va[i] = EV.a[i] * c;
    if (EV.q[i] >= L.LIMITE_SUSPEITO) { EV.sus[i] = 1; EV.nSus++; }
    // último bloqueio de cada filial × produto (para "há quanto tempo está bloqueado"). O recebimento
    // fica de fora: entra e sai do bloqueado em horas (armazenagem) e esconderia a idade do que ficou.
    if (L.TIPOS[EV.k[i]] && L.TIPOS[EV.k[i]].s === 1 && L.TIPOS[EV.k[i]].g !== 7) {
      var ps = posDe.get(chaveFP(E.f[i], EV.p[i]));
      if (ps != null) { ES.ultBloq[ps] = EV.dia[i]; ES.motUlt[ps] = EV.m[i]; }
    }
  }
  EV.diaMin = n ? EV.dia[0] : 0; EV.diaMax = n ? EV.dia[n - 1] : 0;

  // ---- inventário rotativo
  var I = J.inv, nI = I.n;
  var IV = L.IV = { n: nI, i: Int32Array.from(I.i), f: Int16Array.from(I.f), p: new Int32Array(nI), dia: Int32Array.from(I.dd), tc: new Int32Array(nI), ta: new Int32Array(nI),
                    uc: new Int16Array(nI), ua: new Int16Array(nI), qc: Float64Array.from(I.qc, nz), qs: Float64Array.from(I.qs, nz), c: Float64Array.from(I.c, nz),
                    dif: new Float64Array(nI), vdif: new Float64Array(nI), vsis: new Float64Array(nI), s: Int8Array.from(I.s) };
  for (var j = 0; j < nI; j++) {
    IV.p[j] = pIdx(I.p[j]); IV.tc[j] = I.tc[j] == null ? -1 : I.tc[j]; IV.ta[j] = I.ta[j] == null ? -1 : I.ta[j];
    var uc = D.iFun.get(I.uc[j]), ua = D.iFun.get(I.ua[j]); IV.uc[j] = uc == null ? -1 : uc; IV.ua[j] = ua == null ? -1 : ua;
    IV.dif[j] = I.aj[j] == null ? IV.qc[j] - IV.qs[j] : I.aj[j];
    IV.vdif[j] = I.v[j] == null ? IV.dif[j] * IV.c[j] : I.v[j];
    IV.vsis[j] = IV.qs[j] * IV.c[j];
  }
  IV.diaMin = nI ? IV.dia[0] : 0; IV.diaMax = nI ? IV.dia[nI - 1] : 0;

  L.anos = []; for (var y = +L.isoDeDia(Math.min(EV.diaMin, IV.diaMin || EV.diaMin)).slice(0, 4); y <= new Date().getFullYear(); y++) L.anos.push(y);
  construirRegistro();
  cacheFiltro.clear();
}
function nz(x) { return x == null ? 0 : x; }

/* ------------------------------ registro de dimensões ------------------------------ */
/* Cada dimensão sabe: listar opções (código + nome), dar o nome de um código e dizer
   o código de um movimento (ev), de uma linha do inventário (iv) e da posição (es). */
function construirRegistro() {
  var D = L.D, P = L.P, EV = L.EV, IV = L.IV, ES = L.ES;
  var R = L.DIM = {};
  function def(k, rot, rotP, icone, cfg) { R[k] = Object.assign({ chave: k, rot: rot, rotP: rotP, icone: icone }, cfg); }
  var nomeFil = function (c) { var i = D.iFil.get(+c); return i == null ? "Filial " + c : "Filial " + c + " · " + titulo(D.filiais[i][1]); };
  def("filial", "Filial", "Filiais", "loja", {
    todos: function () { return D.filiais.map(function (f) { return { id: f[0], t: "Filial " + f[0] + " · " + titulo(f[1]), s: titulo(f[2] || "") + (f[3] ? "/" + f[3] : "") }; }); },
    nome: nomeFil, ev: function (i) { return EV.f[i]; }, iv: function (i) { return IV.f[i]; }, es: function (i) { return ES.f[i]; } });
  def("tipo", "Tipo de movimento", "Tipos", "etiqueta", {
    todos: function () { return L.TIPOS.filter(function (x) { return x.id; }).concat([L.TIPOS[0]]).map(function (x) { return { id: x.id, t: x.nome, s: L.ROTINAS[x.g].nome.split(" · ")[0] }; }); },
    nome: function (c) { return L.TIPOS[c] ? L.TIPOS[c].nome : "Tipo " + c; }, cor: function (c) { return L.corTipo(c); }, ev: function (i) { return EV.k[i]; } });
  def("rotina", "Rotina de origem", "Rotinas", "camadas", {
    todos: function () { return L.ROTINAS.map(function (x) { return { id: x.id, t: x.nome }; }); },
    nome: function (c) { return L.ROTINAS[c] ? L.ROTINAS[c].nome : "—"; }, ev: function (i) { return L.TIPOS[EV.k[i]].g; } });
  def("sentido", "Sentido", "Sentidos", "ordem", {
    todos: function () { return L.SENTIDOS.map(function (x) { return { id: x.id, t: x.nome }; }); },
    nome: function (c) { var x = L.SENTIDOS.filter(function (s) { return s.id === +c; })[0]; return x ? x.nome : "—"; }, ev: function (i) { return L.TIPOS[EV.k[i]].s; } });
  def("motivo", "Motivo", "Motivos", "alerta", {
    todos: function () { return D.motivos.map(function (m) { return { id: m[0], t: titulo(m[1] || "Motivo " + m[0]), s: "cód. " + m[0] }; }).concat([{ id: -1, t: "Sem motivo" }]); },
    nome: function (c) { if (+c === -1) return "Sem motivo"; var i = D.iMot.get(+c); return i == null ? "Motivo " + c : titulo(D.motivos[i][1] || "Motivo " + c); },
    ev: function (i) { return EV.m[i] < 0 ? -1 : D.motivos[EV.m[i]][0]; } });
  var nomeFun = function (c) { if (+c === 0 || +c === -1) return "Sem funcionário"; var i = D.iFun.get(+c); if (i == null) return "Matrícula " + c; var f = D.funcs[i]; return +c === 1 ? "PCADMIN (sistema / WMS)" : titulo(f[1]); };
  def("func", "Funcionário", "Funcionários", "pessoas", {
    todos: function () { return D.funcs.map(function (f) { return { id: f[0], t: nomeFun(f[0]), s: "mat. " + f[0] + (f[2] ? " · " + titulo(f[2]) : "") }; }); },
    nome: nomeFun, sub: function (c) { var i = D.iFun.get(+c); return i == null ? "" : "mat. " + c + (D.funcs[i][2] ? " · " + titulo(D.funcs[i][2]) : ""); },
    ev: function (i) { return EV.u[i] < 0 ? 0 : D.funcs[EV.u[i]][0]; }, iv: function (i) { return IV.uc[i] < 0 ? 0 : D.funcs[IV.uc[i]][0]; } });
  def("funcAtu", "Quem atualizou o inventário", "Quem atualizou", "verificar", {
    todos: function () { return R.func.todos(); }, nome: nomeFun, iv: function (i) { return IV.ua[i] < 0 ? 0 : D.funcs[IV.ua[i]][0]; } });
  var prodCod = function (pi) { return pi < 0 ? -1 : P.cod[pi]; };
  def("depto", "Departamento", "Departamentos", "camadas", {
    todos: function () { return D.deptos.map(function (d) { return { id: d[0], t: titulo(d[1] || "Depto " + d[0]) }; }); },
    nome: function (c) { var i = D.iDep.get(+c); return i == null ? "Sem departamento" : titulo(D.deptos[i][1] || "Depto " + c); },
    deProd: function (pi) { return pi < 0 ? -1 : P.dep[pi]; } });
  def("secao", "Seção", "Seções", "etiqueta", {
    todos: function () { return D.secoes.map(function (s) { var di = D.iDep.get(s[2]); return { id: s[0], t: titulo(s[1] || "Seção " + s[0]), s: di == null ? "" : titulo(D.deptos[di][1]) }; }); },
    nome: function (c) { var i = D.iSec.get(+c); return i == null ? "Sem seção" : titulo(D.secoes[i][1] || "Seção " + c); },
    deProd: function (pi) { return pi < 0 ? -1 : P.sec[pi]; } });
  def("fornecedor", "Fornecedor", "Fornecedores", "caixa", {
    todos: function () { return D.fornecedores.map(function (f) { return { id: f[0], t: titulo(f[1] || "Fornecedor " + f[0]), s: "cód. " + f[0] }; }); },
    nome: function (c) { var i = D.iFor.get(+c); return i == null ? "Sem fornecedor" : titulo(D.fornecedores[i][1] || "Fornecedor " + c); },
    sub: function (c) { return "cód. " + c; }, deProd: function (pi) { return pi < 0 ? -1 : P.forn[pi]; } });
  def("produto", "Produto", "Produtos", "caixa", {
    todos: function () { var o = new Array(P.n); for (var i = 0; i < P.n; i++) o[i] = { id: P.cod[i], t: P.desc[i], s: P.cod[i] + (P.emb[i] ? " · " + P.emb[i] : "") }; return o; },
    nome: function (c) { var i = P.i.get(+c); return i == null ? "Produto " + c : P.desc[i]; },
    sub: function (c) { var i = P.i.get(+c); return i == null ? "" : "cód. " + c + (P.emb[i] ? " · " + P.emb[i] : ""); },
    deProd: prodCod });
  ["depto", "secao", "fornecedor", "produto"].forEach(function (k) {
    var d = R[k];
    d.ev = function (i) { return d.deProd(EV.p[i]); }; d.iv = function (i) { return d.deProd(IV.p[i]); }; d.es = function (i) { return d.deProd(ES.p[i]); };
  });
  def("resultado", "Resultado da contagem", "Resultados", "alvo", {
    todos: function () { return L.RESULTADOS.map(function (x) { return { id: x.id, t: x.nome }; }); },
    nome: function (c) { var x = L.RESULTADOS.filter(function (r) { return r.id === +c; })[0]; return x ? x.nome : "—"; },
    iv: function (i) { var d = IV.dif[i]; return d > 0.0005 ? 1 : d < -0.0005 ? -1 : 0; } });
  def("inventario", "Nº do inventário", "Inventários", "tabela", {
    todos: function () { var vis = new Set(), o = []; for (var i = IV.n - 1; i >= 0; i--) if (!vis.has(IV.i[i])) { vis.add(IV.i[i]); o.push({ id: IV.i[i], t: "Inventário " + IV.i[i], s: L.fDia(IV.dia[i]) + " · filial " + IV.f[i] }); } return o; },
    nome: function (c) { return "Inventário nº " + c; }, iv: function (i) { return IV.i[i]; } });
  def("dow", "Dia da semana", "Dias da semana", "calendario", {
    todos: function () { return [1, 2, 3, 4, 5, 6, 0].map(function (d) { return { id: d, t: L.DIAS_SEMANA[d] }; }); },
    nome: function (c) { return L.DIAS_SEMANA[+c] || "—"; },
    ev: function (i) { return (EV.dia[i] + L.BASE_DOW) % 7; }, iv: function (i) { return (IV.dia[i] + L.BASE_DOW) % 7; } });
  def("hora", "Hora do dia", "Horas", "relogio", {
    todos: function () { var o = []; for (var h = 0; h < 24; h++) o.push({ id: h, t: (h < 10 ? "0" : "") + h + "h" }); return o; },
    nome: function (c) { return (+c < 10 ? "0" : "") + (+c) + "h"; }, ev: function (i) { return Math.floor((EV.t[i] % 1440) / 60); } });
  def("mes", "Mês", "Meses", "calendario", {
    todos: function () { var o = [], k = L.mesDeDia(Math.min(EV.diaMin, IV.diaMin || EV.diaMin)), fim = L.mesDeDia(L.hojeDia());
      while (k <= fim) { o.unshift({ id: k, t: L.fMesKLongo(k) }); k = k % 100 === 12 ? k + 89 : k + 1; } return o; },
    nome: function (c) { return L.fMesKLongo(+c); }, curto: function (c) { return L.fMesK(+c); },
    ev: function (i) { return L.mesDeDia(EV.dia[i]); }, iv: function (i) { return L.mesDeDia(IV.dia[i]); } });
  def("dia", "Dia", "Dias", "calendario", {
    todos: function () { return []; }, nome: function (c) { var d = +c; return L.DIAS_SEMANA[(d + L.BASE_DOW) % 7] + ", " + L.fDia(d); }, curto: function (c) { return L.fDiaCurto(+c); },
    ev: function (i) { return EV.dia[i]; }, iv: function (i) { return IV.dia[i]; } });
  def("doc", "Documento (transação de entrada)", "Documentos", "tabela", {
    todos: function () { return []; }, nome: function (c) { return +c ? "Transação " + c : "Sem documento"; }, ev: function (i) { return EV.d[i]; } });

  Object.keys(R).forEach(function (k) {
    var d = R[k]; d.cache = null;
    d.itens = function () { if (!d.cache) { d.cache = d.todos().map(function (x) { x.n = L.norm(x.t + " " + (x.s || "") + " " + x.id); return x; }); } return d.cache; };
  });
}
/* "LUBE DISTRIBUIDORA" -> "Lube Distribuidora" (preposições minúsculas). Mantém siglas curtas. */
var MIN = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, em: 1, a: 1, o: 1, p: 1, para: 1, com: 1 };
function titulo(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim().split(" ").map(function (w, i) {
    if (!w) return w; if (i && MIN[w]) return w;
    if (/^(wms|nf|rca|sac|cd|ltda|me|ba|rj|es|sp|mg)$/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}
L.titulo = titulo;
L.nomeDe = function (dim, id) { var d = L.DIM[dim]; return d ? d.nome(id) : String(id); };

/* ------------------------------ período ------------------------------ */
L.RAPIDOS = [["hoje", "Hoje"], ["d7", "7 dias"], ["d30", "30 dias"], ["mes", "Mês atual"], ["mesant", "Mês anterior"], ["ano", "Ano atual"], ["m12", "12 meses"], ["tudo", "Tudo"]];
/* período ativo → { de, ate (dias, inclusive), rot, tipo } */
L.periodo = function (per) {
  per = per || L.estado.periodo || { r: "d30" };
  var hoje = L.hojeDia(), de, ate, rot;
  switch (per.r) {
    case "hoje": de = ate = hoje; rot = "Hoje, " + L.fDia(hoje); break;
    case "d7": de = hoje - 6; ate = hoje; rot = "Últimos 7 dias"; break;
    case "d30": de = hoje - 29; ate = hoje; rot = "Últimos 30 dias"; break;
    case "mes": de = primeiroDoMes(hoje); ate = hoje; rot = L.fMesKLongo(L.mesDeDia(hoje)) + " (até " + L.fDiaCurto(hoje) + ")"; break;
    case "mesant": ate = primeiroDoMes(hoje) - 1; de = primeiroDoMes(ate); rot = L.fMesKLongo(L.mesDeDia(de)); break;
    case "ano": de = L.diaDeIso(L.isoDeDia(hoje).slice(0, 4) + "-01-01"); ate = hoje; rot = "Ano de " + L.isoDeDia(hoje).slice(0, 4); break;
    case "m12": de = primeiroDoMes(somarMeses(hoje, -11)); ate = hoje; rot = "Últimos 12 meses"; break;
    case "tudo": de = Math.min(L.EV.diaMin, L.IV.diaMin || L.EV.diaMin); ate = hoje; rot = "Tudo (desde " + L.fDia(de) + ")"; break;
    default:
      de = per.de != null ? L.diaDeIso(per.de) : hoje - 29; ate = per.ate != null ? L.diaDeIso(per.ate) : hoje;
      if (ate < de) { var x = de; de = ate; ate = x; }
      rot = de === ate ? L.fDia(de) : L.fDia(de) + " a " + L.fDia(ate);
      if (de === primeiroDoMes(de) && ate === ultimoDoMes(de)) rot = L.fMesKLongo(L.mesDeDia(de));
  }
  return { de: de, ate: ate, rot: rot, r: per.r || "livre", dias: ate - de + 1 };
};
/* períodos de comparação (padrão da casa, ver "Como eu gosto dos BIs"):
   · meses fechados → os mesmos N meses antes (jan/26 → dez/25);
   · do dia 1 até hoje (mês em andamento) → os N meses antes, até o mesmo dia do mês;
   · datas livres → os mesmos N dias imediatamente antes.
   Ano anterior: as mesmas datas, um ano antes. */
function mesesEntre(de, ate) { var a = L.mesDeDia(de), b = L.mesDeDia(ate); return (Math.floor(b / 100) * 12 + b % 100) - (Math.floor(a / 100) * 12 + a % 100) + 1; }
L.comparacoes = function (p) {
  if (p.r === "tudo") return { pa: null, aa: null };
  var de = p.de, ate = p.ate, pa = null;
  var inicioMes = de === primeiroDoMes(de), meses = mesesEntre(de, ate);
  if (p.r === "ano") pa = null;                                                   // ano até hoje: só o ano anterior faz sentido
  else if (inicioMes && ate === ultimoDoMes(ate)) pa = { de: somarMeses(de, -meses), ate: ultimoDoMes(somarMeses(de, -1)) };
  else if (inicioMes && ate === L.hojeDia()) pa = { de: somarMeses(de, -meses), ate: somarMeses(ate, -meses) };
  else pa = { de: de - p.dias, ate: de - 1 };
  var aa = { de: somarMeses(de, -12), ate: somarMeses(ate, -12) };
  var curto = function (x) {                       // "21/08–19/09" ou "set/26"
    if (x.de === primeiroDoMes(x.de) && x.ate === ultimoDoMes(x.ate)) return x.de === primeiroDoMes(x.ate) ? L.fMesK(L.mesDeDia(x.de)) : L.fMesK(L.mesDeDia(x.de)) + "–" + L.fMesK(L.mesDeDia(x.ate));
    var a = L.isoDeDia(x.de), b = L.isoDeDia(x.ate), mesmoAno = a.slice(0, 4) === b.slice(0, 4);
    var fd = function (s, ano) { return s.slice(8, 10) + "/" + s.slice(5, 7) + (ano ? "/" + s.slice(2, 4) : ""); };
    return x.de === x.ate ? fd(a, true) : fd(a, !mesmoAno) + "–" + fd(b, true);
  };
  var rotDe = function (x) {
    if (x.de === primeiroDoMes(x.de) && x.ate === ultimoDoMes(x.ate)) return x.de === primeiroDoMes(x.ate) ? L.fMesKLongo(L.mesDeDia(x.de)) : L.fMesK(L.mesDeDia(x.de)) + " a " + L.fMesK(L.mesDeDia(x.ate));
    return x.de === x.ate ? L.fDia(x.de) : L.fDia(x.de) + " a " + L.fDia(x.ate);
  };
  if (pa) { pa.rot = rotDe(pa); pa.curto = curto(pa); } aa.rot = rotDe(aa); aa.curto = curto(aa);
  var ini = Math.min(L.EV.diaMin, L.IV.diaMin || L.EV.diaMin);
  return { pa: pa && pa.ate >= ini ? pa : null, aa: aa.ate >= ini ? aa : null };
};

/* ------------------------------ filtros → máscaras ------------------------------ */
/* spec = { de, ate, f: { chave: [códigos] }, sus: bool }. Devolve os índices que passam. */
var cacheFiltro = new Map();
function conjunto(arr) { var s = new Set(); arr.forEach(function (x) { s.add(+x); }); return s; }
function mascaraProdutos(f) {
  var ks = ["depto", "secao", "fornecedor", "produto"].filter(function (k) { return f[k] && f[k].length; });
  if (!ks.length) return null;
  var P = L.P, m = new Uint8Array(P.n), sets = ks.map(function (k) { return [L.DIM[k], conjunto(f[k])]; });
  for (var i = 0; i < P.n; i++) {
    var ok = 1;
    for (var j = 0; j < sets.length && ok; j++) if (!sets[j][1].has(sets[j][0].deProd(i))) ok = 0;
    m[i] = ok;
  }
  return m;
}
function busca(arr, v, n, sup) {              // primeira posição com arr[i] >= v (ou > v, se sup)
  var a = 0, b = n;
  while (a < b) { var m = (a + b) >> 1; if (sup ? arr[m] <= v : arr[m] < v) a = m + 1; else b = m; }
  return a;
}
L.filtrarEv = function (spec) {
  var chave = "ev|" + JSON.stringify(spec);
  if (cacheFiltro.has(chave)) return cacheFiltro.get(chave);
  var EV = L.EV, f = spec.f || {};
  var i0 = spec.de == null ? 0 : busca(EV.dia, spec.de, EV.n, false), i1 = spec.ate == null ? EV.n : busca(EV.dia, spec.ate, EV.n, true);
  var mp = mascaraProdutos(f);
  var testes = [];
  ["filial", "tipo", "rotina", "sentido", "motivo", "func", "dow", "hora", "doc", "mes", "dia"].forEach(function (k) {
    if (f[k] && f[k].length) { var s = conjunto(f[k]), d = L.DIM[k]; testes.push(function (i) { return s.has(d.ev(i)); }); }
  });
  var out = new Int32Array(Math.max(0, i1 - i0)), n = 0, sus = !!spec.sus;
  for (var i = i0; i < i1; i++) {
    if (!sus && EV.sus[i]) continue;
    if (mp && (EV.p[i] < 0 || !mp[EV.p[i]])) continue;
    var ok = true;
    for (var j = 0; j < testes.length; j++) if (!testes[j](i)) { ok = false; break; }
    if (ok) out[n++] = i;
  }
  var res = out.subarray(0, n);
  res.suspeitosFora = 0;
  if (!sus) for (var x = i0; x < i1; x++) if (EV.sus[x]) res.suspeitosFora++;
  guardar(chave, res);
  return res;
};
L.filtrarIv = function (spec) {
  var chave = "iv|" + JSON.stringify(spec);
  if (cacheFiltro.has(chave)) return cacheFiltro.get(chave);
  var IV = L.IV, f = spec.f || {};
  var i0 = spec.de == null ? 0 : busca(IV.dia, spec.de, IV.n, false), i1 = spec.ate == null ? IV.n : busca(IV.dia, spec.ate, IV.n, true);
  var mp = mascaraProdutos(f), testes = [];
  ["filial", "func", "funcAtu", "resultado", "inventario", "dow", "mes", "dia"].forEach(function (k) {
    if (f[k] && f[k].length && L.DIM[k].iv) { var s = conjunto(f[k]), d = L.DIM[k]; testes.push(function (i) { return s.has(d.iv(i)); }); }
  });
  var out = new Int32Array(Math.max(0, i1 - i0)), n = 0;
  for (var i = i0; i < i1; i++) {
    if (IV.s[i] === 2) continue;                                    // cancelado
    if (mp && (IV.p[i] < 0 || !mp[IV.p[i]])) continue;
    var ok = true;
    for (var j = 0; j < testes.length; j++) if (!testes[j](i)) { ok = false; break; }
    if (ok) out[n++] = i;
  }
  var res = out.subarray(0, n);
  guardar(chave, res);
  return res;
};
L.filtrarEs = function (spec) {
  var chave = "es|" + JSON.stringify(spec.f || {}) + "|" + (spec.todos ? 1 : 0);
  if (cacheFiltro.has(chave)) return cacheFiltro.get(chave);
  var ES = L.ES, f = spec.f || {}, mp = mascaraProdutos(f), fil = f.filial && f.filial.length ? conjunto(f.filial) : null;
  var out = new Int32Array(ES.n), n = 0;
  for (var i = 0; i < ES.n; i++) {
    if (!spec.todos && !(ES.b[i] > 0 || ES.a[i] > 0)) continue;
    if (fil && !fil.has(ES.f[i])) continue;
    if (mp && (ES.p[i] < 0 || !mp[ES.p[i]])) continue;
    out[n++] = i;
  }
  var res = out.subarray(0, n);
  guardar(chave, res);
  return res;
};
function guardar(k, v) { cacheFiltro.set(k, v); if (cacheFiltro.size > 60) cacheFiltro.delete(cacheFiltro.keys().next().value); }

/* spec a partir do estado da tela: filtros + período. extra: { f: {...} } sobrepõe; periodo: {de,ate} troca o período */
L.spec = function (extra, periodo) {
  var p = periodo || L.periodo(), f = {};
  var src = L.estado.filtros; for (var k in src) if (src[k] && src[k].length) f[k] = src[k].slice();
  if (extra && extra.f) for (var k2 in extra.f) { if (extra.f[k2] == null) delete f[k2]; else f[k2] = extra.f[k2].slice(); }
  return { de: p.de, ate: p.ate, f: f, sus: !!L.estado.suspeitos };
};

/* ------------------------------ somas ------------------------------ */
/* resumo dos movimentos: contagem, quantidades e valores por sentido, avaria e distintos */
L.resumoEv = function (idx) {
  var EV = L.EV, T = L.TIPOS, r = { n: idx.length, q: 0, v: 0, qe: 0, ve: 0, ne: 0, qs: 0, vs: 0, ns: 0, qn: 0, vn: 0, nn: 0, qa: 0, va: 0, qab: 0, vab: 0, skus: 0, funcs: 0, docs: 0,
                               porTipo: new Float64Array(T.length), qTipo: new Float64Array(T.length), nTipo: new Int32Array(T.length), vaTipo: new Float64Array(T.length), qaTipo: new Float64Array(T.length) };
  var prods = new Set(), funcs = new Set(), docs = new Set();
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], k = EV.k[i], s = T[k].s, q = EV.q[i], v = EV.v[i];
    r.q += q; r.v += v; r.porTipo[k] += v; r.qTipo[k] += q; r.nTipo[k]++;
    if (s === 1) { r.qe += q; r.ve += v; r.ne++; } else if (s === -1) { r.qs += q; r.vs += v; r.ns++; } else { r.qn += q; r.vn += v; r.nn++; }
    if (EV.a[i] > 0) { r.qaTipo[k] += EV.a[i]; r.vaTipo[k] += EV.va[i]; if (k === 5) { r.qab += EV.a[i]; r.vab += EV.va[i]; } else { r.qa += EV.a[i]; r.va += EV.va[i]; } }
    prods.add(EV.p[i]); if (EV.u[i] >= 0) funcs.add(EV.u[i]); if (EV.d[i]) docs.add(EV.d[i]);
  }
  r.skus = prods.size; r.funcs = funcs.size; r.docs = docs.size; r.saldo = r.ve - r.vs;
  r.va266 = r.vaTipo[2] + r.vaTipo[3]; r.qa266 = r.qaTipo[2] + r.qaTipo[3];               // avaria registrada na 266
  return r;
};
/* agrupa movimentos por uma dimensão: [{ k, n, q, v, qe, ve, qs, vs, qa, va, skus }] ordenado por v desc */
L.agruparEv = function (idx, dim, opts) {
  opts = opts || {};
  var EV = L.EV, T = L.TIPOS, d = L.DIM[dim], m = new Map();
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], key = d.ev(i), g = m.get(key);
    if (!g) { g = { k: key, n: 0, q: 0, v: 0, qe: 0, ve: 0, ne: 0, qs: 0, vs: 0, ns: 0, qn: 0, vn: 0, nn: 0, qa: 0, va: 0, ult: 0, p: opts.skus ? new Set() : null }; m.set(key, g); }
    var s = T[EV.k[i]].s, q = EV.q[i], v = EV.v[i];
    g.n++; g.q += q; g.v += v; if (EV.t[i] > g.ult) g.ult = EV.t[i];
    if (s === 1) { g.qe += q; g.ve += v; g.ne++; } else if (s === -1) { g.qs += q; g.vs += v; g.ns++; } else { g.qn += q; g.vn += v; g.nn++; }
    if (EV.a[i] > 0 && EV.k[i] !== 5) { g.qa += EV.a[i]; g.va += EV.va[i]; }
    if (g.p) g.p.add(EV.p[i]);
  }
  var out = Array.from(m.values());
  out.forEach(function (g) { g.saldo = g.ve - g.vs; if (g.p) { g.skus = g.p.size; g.p = null; } });
  var ord = opts.ordem || "v";
  out.sort(typeof ord === "function" ? ord : function (a, b) { return b[ord] - a[ord]; });
  return out;
};
/* inventário: resumo e agrupamento */
L.resumoIv = function (idx) {
  var IV = L.IV, r = { n: idx.length, inv: 0, skus: 0, iguais: 0, sobra: 0, falta: 0, vsobra: 0, vfalta: 0, qsobra: 0, qfalta: 0, vsis: 0, liq: 0, abs: 0, abertos: 0 };
  var invs = new Set(), prods = new Set();
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], d = IV.dif[i], v = IV.vdif[i];
    invs.add(IV.i[i]); prods.add(IV.p[i]); r.vsis += IV.vsis[i];
    if (IV.s[i] === 1) r.abertos++;
    if (d > 0.0005) { r.sobra++; r.qsobra += d; r.vsobra += v; } else if (d < -0.0005) { r.falta++; r.qfalta += -d; r.vfalta += -v; } else r.iguais++;
  }
  r.inv = invs.size; r.skus = prods.size; r.liq = r.vsobra - r.vfalta; r.abs = r.vsobra + r.vfalta;
  r.acuracia = r.n ? r.iguais / r.n : null; r.pctDiv = r.vsis ? r.abs / r.vsis : null;
  return r;
};
L.agruparIv = function (idx, dim, opts) {
  opts = opts || {};
  var IV = L.IV, d = L.DIM[dim], m = new Map();
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], key = d.iv(i), g = m.get(key);
    if (!g) { g = { k: key, n: 0, iguais: 0, sobra: 0, falta: 0, vsobra: 0, vfalta: 0, qsobra: 0, qfalta: 0, vsis: 0, inv: new Set(), prods: new Set(), dia: IV.dia[i], f: IV.f[i], uc: IV.uc[i], ultDia: IV.dia[i] }; m.set(key, g); }
    var dd = IV.dif[i], v = IV.vdif[i];
    g.n++; g.vsis += IV.vsis[i]; g.inv.add(IV.i[i]); g.prods.add(IV.p[i]); if (IV.dia[i] > g.ultDia) g.ultDia = IV.dia[i];
    if (dd > 0.0005) { g.sobra++; g.qsobra += dd; g.vsobra += v; } else if (dd < -0.0005) { g.falta++; g.qfalta += -dd; g.vfalta += -v; } else g.iguais++;
  }
  var out = Array.from(m.values());
  out.forEach(function (g) { g.ninv = g.inv.size; g.skus = g.prods.size; g.inv = g.prods = null; g.liq = g.vsobra - g.vfalta; g.abs = g.vsobra + g.vfalta; g.acuracia = g.n ? g.iguais / g.n : null; g.div = g.sobra + g.falta; });
  var ord = opts.ordem || "abs";
  out.sort(typeof ord === "function" ? ord : function (a, b) { return b[ord] - a[ord]; });
  return out;
};
/* posição: resumo e agrupamento */
L.resumoEs = function (idx) {
  var ES = L.ES, r = { n: idx.length, vb: 0, va: 0, qb: 0, qa: 0, ve: 0, skus: 0 };
  var prods = new Set();
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], c = ES.c[i];
    r.qb += ES.b[i]; r.qa += ES.a[i]; r.vb += ES.b[i] * c; r.va += ES.a[i] * c; r.ve += Math.max(0, ES.e[i]) * c;
    if (ES.b[i] > 0) prods.add(ES.p[i]);
  }
  r.skus = prods.size; r.vo = r.vb - r.va; r.pct = r.ve ? r.vb / r.ve : null;
  return r;
};
L.agruparEs = function (idx, dim) {
  var ES = L.ES, d = L.DIM[dim], m = new Map();
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], key = d.es(i), g = m.get(key);
    if (!g) { g = { k: key, n: 0, vb: 0, va: 0, qb: 0, qa: 0 }; m.set(key, g); }
    g.n++; g.vb += ES.b[i] * ES.c[i]; g.va += ES.a[i] * ES.c[i]; g.qb += ES.b[i]; g.qa += ES.a[i];
  }
  var out = Array.from(m.values()); out.forEach(function (g) { g.vo = g.vb - g.va; });
  out.sort(function (a, b) { return b.vb - a.vb; });
  return out;
};

/* série por dia ou por mês, conforme o tamanho do período */
L.granularidade = function (p) { return p.dias <= 62 ? "dia" : "mes"; };
L.serieEv = function (idx, p, porTipo) {
  var gran = L.granularidade(p), EV = L.EV, T = L.TIPOS, chaves = [], pos = new Map();
  if (gran === "dia") for (var d = p.de; d <= p.ate; d++) { pos.set(d, chaves.length); chaves.push(d); }
  else { var k = L.mesDeDia(p.de), fim = L.mesDeDia(p.ate); while (k <= fim) { pos.set(k, chaves.length); chaves.push(k); k = k % 100 === 12 ? k + 89 : k + 1; } }
  var n = chaves.length, z = function () { return new Float64Array(n); };
  var s = { gran: gran, chaves: chaves, n: new Float64Array(n), ve: z(), vs: z(), vn: z(), qe: z(), qs: z(), qn: z(), ne: z(), ns: z(), nn: z(), tipo: porTipo ? L.TIPOS.map(z) : null };
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], key = gran === "dia" ? EV.dia[i] : L.mesDeDia(EV.dia[i]), x = pos.get(key);
    if (x == null) continue;
    var sg = T[EV.k[i]].s, v = EV.v[i], q = EV.q[i];
    s.n[x]++;
    if (sg === 1) { s.ve[x] += v; s.qe[x] += q; s.ne[x]++; } else if (sg === -1) { s.vs[x] += v; s.qs[x] += q; s.ns[x]++; } else { s.vn[x] += v; s.qn[x] += q; s.nn[x]++; }
    if (s.tipo) s.tipo[EV.k[i]][x] += v;
  }
  s.rot = chaves.map(function (c) { return gran === "dia" ? L.fDiaCurto(c) : L.fMesK(c); });
  return s;
};

/* texto dos filtros aplicados (planilha e cabeçalho dos relatórios) */
L.descricaoFiltros = function (extra, semPeriodo) {
  var out = [], f = L.estado.filtros;
  if (!semPeriodo) out.push(["Período", L.periodo().rot]);
  out.push(["Dados até", L.META.ult_mov ? L.fDataHora(L.META.ult_mov) : "—"]);
  Object.keys(f).forEach(function (k) {
    var a = f[k]; if (!a || !a.length || !L.DIM[k]) return;
    var nomes = a.map(function (id) { return L.nomeDe(k, id); });
    out.push([L.DIM[k].rot, nomes.length > 6 ? nomes.slice(0, 6).join("; ") + " e mais " + (nomes.length - 6) : nomes.join("; ")]);
  });
  if (L.estado.suspeitos) out.push(["Movimentos suspeitos", "incluídos"]);
  if (extra) extra.forEach(function (x) { out.push(x); });
  return out;
};

})();
