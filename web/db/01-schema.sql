-- =============================================================================
-- MOVIMENTAÇÃO DE INVENTÁRIO — schema `inventario` no DATA WAREHOUSE
-- Migração inventario_01_schema (2026-10-19).
--
-- Fonte: WinThor, rotinas 266 (Bloquear Produtos no Estoque → PCLOGDESBLOQUEIO)
-- e 1147 (Manutenção de inventário rotativo → PCINVENTROT + PCLOGATUALIZAINVENT),
-- mais o PCEST de hoje e, desde a migração 07, o recebimento de compra (1301 → PCMOV).
-- Carga: etl/sync_inventario.py (TRUNCATE + INSERT nos fatos,
-- upsert nos cadastros). Toda tabela com RLS ligado e SEM políticas: a chave
-- pública não lê nada; só o ETL e as funções da Vercel (credencial de servidor).
-- =============================================================================

create schema if not exists inventario;
comment on schema inventario is
  'MOVIMENTAÇÃO DE INVENTÁRIO: rotinas 266 (bloqueio/desbloqueio do estoque) e 1147 (inventário rotativo) do WinThor. ETL em Desktop\BI\16. INVENTARIO.';

-- ----------------------------------------------------------------------------- controle
create table if not exists inventario.controle_carga (
  id               bigserial primary key,
  consulta         text,
  tabela_destino   text,
  status           text,
  linhas           integer,
  linhas_esperadas integer,
  segundos         numeric,
  mensagem         text,
  executado_em     timestamptz default now()
);
create index if not exists controle_carga_executado_em on inventario.controle_carga (executado_em desc);

-- ----------------------------------------------------------------------------- 266
-- Um registro por movimento do estoque BLOQUEADO, exatamente como o WinThor gravou.
-- A leitura de cada campo depende do programa que gravou: ver inventario.vw_bloqueio.
create table if not exists inventario.fato_bloqueio (
  dt              timestamp not null,          -- hora local do WinThor
  codfilial       smallint  not null,
  codprod         integer   not null,
  codfunc         integer,                     -- matrícula (1 = PCADMIN, usado pelo WMS)
  coddevol        integer,                     -- motivo (PCTABDEV)
  programa        text,
  qtbloqueada     numeric,
  qtdesbloqueada  numeric,
  qtindeniz       numeric,
  qtbloqueadaant  numeric,
  qtindenizant    numeric,
  numtransent     bigint
);
create index if not exists fato_bloqueio_dt on inventario.fato_bloqueio (dt);
create index if not exists fato_bloqueio_prod on inventario.fato_bloqueio (codfilial, codprod, dt);

-- ----------------------------------------------------------------------------- 1301
-- Recebimento de compra (migração inventario_07_recebimento, 2026-10-20). O recebimento
-- entra BLOQUEADO e o livro da 266 não registra esse bloqueio, só a liberação; quem
-- registra quanto entrou bloqueado é a própria linha do PCMOV (QTBLOQUEADA). Conferido
-- contra a foto diária do estoque (PCHISTEST): ver etl/conferir_recebimento.py.
-- Um registro por linha do PCMOV (E/EB/ER da 1301); o estorno do cancelamento vem com
-- quantidade negativa.
create table if not exists inventario.fato_recebimento (
  dt                   timestamp not null,     -- entrada: data e hora de lançamento da nota (PCNFENT); estorno: as do PCMOV
  codfilial            smallint  not null,
  codprod              integer   not null,
  numtransent          bigint,
  numnota              bigint,
  codfornec            integer,                -- fornecedor da nota
  codfunc              integer,                -- quem lançou a nota (PCNFENT.CODFUNCLANC)
  codoper              text,                   -- E, EB ou ER
  qt                   numeric,                -- PCMOV.QT (negativa no estorno)
  qtbloqueada          numeric,                -- PCMOV.QTBLOQUEADA: quanto entrou bloqueado
  estoquedesbloqueado  text,                   -- 'S' = entrou livre (QTBLOQUEADA 0)
  dtcancel             timestamp               -- recebimento cancelado (as duas linhas trazem a data)
);
create index if not exists fato_recebimento_dt on inventario.fato_recebimento (dt);
create index if not exists fato_recebimento_trans on inventario.fato_recebimento (numtransent);
comment on table inventario.fato_recebimento is
  'Recebimento de compra (1301): uma linha por PCMOV E/EB/ER. QTBLOQUEADA = quanto entrou bloqueado (o livro da 266 não registra esse bloqueio). Estorno do cancelamento com QT negativa.';

-- ----------------------------------------------------------------------------- 1147
create table if not exists inventario.fato_inventario (
  numinvent            integer  not null,
  codfilial            smallint not null,
  codprod              integer  not null,
  codlocal             text     not null default '0',
  data                 date,
  dt_contagem          timestamp,
  dt_atualizacao       timestamp,
  dt_cancel            timestamp,
  codfunc_contagem     integer,
  codfunc_atualizacao  integer,
  codfunc_montagem     integer,
  qt1                  numeric,
  qt2                  numeric,
  qt3                  numeric,
  qtestger_inv         numeric,                -- estoque na montagem do inventário
  custo                numeric,
  qtinvent             numeric,                -- do log da atualização (só quando houve diferença)
  qtestger_log         numeric,
  qtdif                numeric,                -- sempre positivo; o sentido está em tipoajuste
  vldif                numeric,
  vlcusto              numeric,
  tipoajuste           text,                   -- EI = sobra, SI = falta
  primary key (numinvent, codfilial, codprod, codlocal)
);
create index if not exists fato_inventario_data on inventario.fato_inventario (data);

-- ----------------------------------------------------------------------------- PCEST de hoje
create table if not exists inventario.fato_posicao (
  codfilial    smallint not null,
  codprod      integer  not null,
  qtestger     numeric,
  qtreserv     numeric,
  qtbloqueada  numeric,                        -- inclui a avaria
  qtindeniz    numeric,                        -- avaria (parte do bloqueado)
  custofin     numeric,
  dtultent     date,
  primary key (codfilial, codprod)
);

-- ----------------------------------------------------------------------------- cadastros
-- Produto próprio deste sistema: o core.dim_produto (dono: BI COMPRAS) não tem
-- departamento, seção nem embalagem. Exceção consciente, registrada no README.
create table if not exists inventario.produto (
  codprod        integer primary key,
  descricao      text,
  embalagem      text,
  unidade        text,
  ean            text,
  codfornec      integer,
  fornecedor     text,
  codepto        integer,
  departamento   text,
  codsec         integer,
  secao          text,
  fora_de_linha  boolean,
  excluido       boolean
);
create table if not exists inventario.funcionario (
  matricula    integer primary key,
  nome         text,
  nome_guerra  text,
  funcao       text,
  situacao     text
);
create table if not exists inventario.motivo (
  coddevol  integer primary key,
  motivo    text
);
create table if not exists inventario.filial (
  codfilial     integer primary key,
  razao_social  text,
  fantasia      text,
  cidade        text,
  uf            text
);

-- ----------------------------------------------------------------------------- cache do painel
-- A carga monta o JSON do painel uma vez, comprime (gzip) e guarda aqui. A API só
-- lê esta linha: o navegador nunca espera o banco montar nada.
create table if not exists inventario.painel_cache (
  id          smallint primary key default 1 check (id = 1),
  gerado_em   timestamptz not null default now(),
  versao      text not null,
  bytes_json  integer,
  bytes_gz    integer,
  payload_gz  bytea not null
);

-- ----------------------------------------------------------------------------- RLS
alter table inventario.controle_carga  enable row level security;
alter table inventario.fato_bloqueio   enable row level security;
alter table inventario.fato_recebimento enable row level security;
alter table inventario.fato_inventario enable row level security;
alter table inventario.fato_posicao    enable row level security;
alter table inventario.produto         enable row level security;
alter table inventario.funcionario     enable row level security;
alter table inventario.motivo          enable row level security;
alter table inventario.filial          enable row level security;
alter table inventario.painel_cache    enable row level security;
