-- =============================================================================
-- Migração inventario_07_recebimento (2026-10-20)
-- O RECEBIMENTO DE COMPRA (rotina 1301) entra como movimento do estoque bloqueado.
--
-- O recebimento entra bloqueado, mas o livro da 266 (PCLOGDESBLOQUEIO) só registra a
-- liberação. Quem registra quanto entrou bloqueado é a linha do PCMOV (QTBLOQUEADA).
-- Conferido contra a foto diária do estoque (PCHISTEST) em etl/conferir_recebimento.py.
--   · inventario.fato_recebimento (nova tabela, RLS sem políticas)
--   · inventario.vw_movimento ganha os tipos 13 (Recebimento de compra, +1),
--     14 (Recebimento cancelado, neutro) e 15 (Recebimento sem bloqueio, neutro)
--   · inventario.painel_dados() lê o recebimento nos cadastros, na base e no "dados até"
-- Definição vigente da view e da função: 02-views-e-funcao.sql; da tabela: 01-schema.sql.
-- =============================================================================

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

alter table inventario.fato_recebimento enable row level security;

create or replace view inventario.vw_movimento as
with f as (
  select b.*,
         case when b.programa = 'PCSIS266'            then 'm266'
              when b.programa like '[PCSIS266 %'      then 'v266'
              when b.programa like 'WMS%'             then 'wms'
              when b.programa ~ '(1303|1346|1361)'    then 'dev'
              when b.programa ~ '1316'                then 'can'
              when b.programa ~ '552'                 then 'aut'
              when b.programa ~ '1122'                then 'mon'
              else 'outro' end as grupo
    from inventario.fato_bloqueio b
)
select f.dt, f.codfilial, f.codprod, f.codfunc, f.coddevol, f.programa, f.numtransent,
       v.tipo, v.qt, v.qt_avaria
  from f
  cross join lateral (values
    (case when f.grupo = 'm266' and coalesce(f.qtbloqueada, 0) > 0
          then case when coalesce(f.qtindeniz, 0) > 0 then 2 else 1 end end,
     f.qtbloqueada, coalesce(f.qtindeniz, 0)),
    (case when f.grupo = 'm266' and coalesce(f.qtdesbloqueada, 0) > 0
          then case when coalesce(f.qtbloqueada, 0) = 0 and coalesce(f.qtindeniz, 0) > 0 then 5 else 4 end end,
     f.qtdesbloqueada, case when coalesce(f.qtbloqueada, 0) = 0 then coalesce(f.qtindeniz, 0) else 0 end),
    (case when f.grupo = 'm266' and coalesce(f.qtbloqueada, 0) = 0 and coalesce(f.qtdesbloqueada, 0) = 0 then 3 end,
     coalesce(f.qtindeniz, 0), coalesce(f.qtindeniz, 0)),
    (case when f.grupo = 'v266' then 4 end, coalesce(f.qtdesbloqueada, 0), 0::numeric),
    (case when f.grupo = 'wms' then 6 end, coalesce(f.qtdesbloqueada, 0), 0::numeric),
    (case when f.grupo = 'dev' then case when f.programa ~ '1346' then 11 when f.programa ~ '1361' then 12 else 7 end end,
     coalesce(f.qtbloqueada, 0), coalesce(f.qtindeniz, 0)),
    (case when f.grupo = 'can' then 8 end, coalesce(f.qtbloqueada, 0), coalesce(f.qtindeniz, 0)),
    (case when f.grupo = 'aut' then 9 end, coalesce(f.qtdesbloqueada, 0), 0::numeric),
    (case when f.grupo = 'mon' then 10 end, coalesce(f.qtbloqueada, 0), 0::numeric),
    (case when f.grupo = 'outro' then 0 end,
     coalesce(nullif(f.qtbloqueada, 0), nullif(f.qtdesbloqueada, 0), f.qtindeniz, 0), coalesce(f.qtindeniz, 0))
  ) as v(tipo, qt, qt_avaria)
 where v.tipo is not null
union all
-- recebimento de compra (1301): o que entrou bloqueado (13), a parte que entrou livre (15)
-- e o estorno do cancelamento (14, neutro). Linha com QT zero não é movimento.
select r.dt, r.codfilial, r.codprod, r.codfunc, null::integer as coddevol, 'PCSIS1301 (PCMOV)'::text as programa,
       r.numtransent, v.tipo, v.qt, 0::numeric as qt_avaria
  from inventario.fato_recebimento r
  cross join lateral (values
    (case when r.qt > 0 and coalesce(r.qtbloqueada, 0) > 0 then 13 end, r.qtbloqueada),
    (case when r.qt > 0 and r.qt - coalesce(r.qtbloqueada, 0) > 0.0005 then 15 end, r.qt - coalesce(r.qtbloqueada, 0)),
    (case when r.qt < 0 then 14 end, -r.qt)
  ) as v(tipo, qt)
 where v.tipo is not null;

comment on view inventario.vw_movimento is
  'Livro de bloqueio (rotina 266 e companhia) lido programa a programa, mais o recebimento de compra (1301, PCMOV.QTBLOQUEADA). Tipos e sentido no comentário da migração inventario_02 (vigente em 02-views-e-funcao.sql).';

-- -----------------------------------------------------------------------------
-- painel_dados() — o pacote inteiro do painel, em colunas (um array por campo).
-- O navegador filtra e soma tudo (exceção consciente ao "uma função, um JSON de
-- totais": ~200 mil movimentos e uma dezena de filtros que se cruzam com tudo).
-- Tempos em minutos desde meta.base; datas em dias desde meta.base. Os movimentos
-- vêm em ordem de data e o tempo vai em DIFERENÇA para o anterior (o navegador soma
-- de volta): o pacote fica menor e a filtragem por período vira busca binária.
-- -----------------------------------------------------------------------------
create or replace function inventario.painel_dados()
returns json
language sql
stable
set search_path = inventario, pg_temp
as $$
with base as (
  select date_trunc('month', least(
           coalesce((select min(dt) from inventario.fato_bloqueio), localtimestamp),
           coalesce((select min(dt) from inventario.fato_recebimento), localtimestamp),
           coalesce((select min(data)::timestamp from inventario.fato_inventario), localtimestamp)))::timestamp as b
),
mov as (
  select m.*, (extract(epoch from (m.dt - (select b from base))) / 60)::bigint as t,
         row_number() over (order by m.dt, m.codfilial, m.codprod, m.tipo) as rn
    from inventario.vw_movimento m
),
movd as (
  select mov.*, t - coalesce(lag(t) over (order by rn), 0) as dtm from mov
),
ev as (
  select json_build_object(
           'n',  count(*),
           'dt', coalesce(json_agg(dtm order by rn), '[]'),
           'f',  coalesce(json_agg(codfilial order by rn), '[]'),
           'p',  coalesce(json_agg(codprod order by rn), '[]'),
           'u',  coalesce(json_agg(coalesce(codfunc, 0) order by rn), '[]'),
           'm',  coalesce(json_agg(coalesce(coddevol, -1) order by rn), '[]'),
           'k',  coalesce(json_agg(tipo order by rn), '[]'),
           'q',  coalesce(json_agg(trim_scale(round(qt, 3)) order by rn), '[]'),
           'a',  coalesce(json_agg(trim_scale(round(qt_avaria, 3)) order by rn), '[]'),
           'd',  coalesce(json_agg(coalesce(numtransent, 0) order by rn), '[]')
         ) as j
    from movd
),
invr as (
  select v.*, row_number() over (order by v.data, v.numinvent, v.codprod) as rn from inventario.vw_inventario v
),
inv as (
  select json_build_object(
           'n',  count(*),
           'i',  coalesce(json_agg(numinvent order by rn), '[]'),
           'f',  coalesce(json_agg(codfilial order by rn), '[]'),
           'p',  coalesce(json_agg(codprod order by rn), '[]'),
           'dd', coalesce(json_agg(data - (select b from base)::date order by rn), '[]'),
           'tc', coalesce(json_agg(case when dt_contagem is null then null
                                        else (extract(epoch from (dt_contagem - (select b from base))) / 60)::bigint end order by rn), '[]'),
           'ta', coalesce(json_agg(case when dt_atualizacao is null then null
                                        else (extract(epoch from (dt_atualizacao - (select b from base))) / 60)::bigint end order by rn), '[]'),
           'uc', coalesce(json_agg(coalesce(codfunc_contagem, 0) order by rn), '[]'),
           'ua', coalesce(json_agg(coalesce(codfunc_atualizacao, 0) order by rn), '[]'),
           'qc', coalesce(json_agg(trim_scale(round(qt_contada, 3)) order by rn), '[]'),
           'qs', coalesce(json_agg(trim_scale(round(qt_sistema, 3)) order by rn), '[]'),
           'c',  coalesce(json_agg(trim_scale(round(custo_un, 6)) order by rn), '[]'),
           'aj', coalesce(json_agg(trim_scale(round(qt_ajuste, 3)) order by rn), '[]'),
           'v',  coalesce(json_agg(trim_scale(round(vl_ajuste, 6)) order by rn), '[]'),   -- cheio: arredondar linha a linha tirava centavos da soma
           's',  coalesce(json_agg(case situacao when 'atualizado' then 0 when 'em contagem' then 1 else 2 end order by rn), '[]')
         ) as j
    from invr
),
est0 as (
  -- todas as linhas do PCEST das filiais (a carga já traz só o que tem estoque, bloqueio ou entrada
  -- recente): o "% do estoque que está bloqueado" precisa do estoque inteiro como base
  select p.* from inventario.fato_posicao p
),
est as (
  select json_build_object(
           'n', count(*),
           'f', coalesce(json_agg(codfilial order by codfilial, codprod), '[]'),
           'p', coalesce(json_agg(codprod order by codfilial, codprod), '[]'),
           'e', coalesce(json_agg(trim_scale(round(coalesce(qtestger, 0), 3)) order by codfilial, codprod), '[]'),
           'b', coalesce(json_agg(trim_scale(round(coalesce(qtbloqueada, 0), 3)) order by codfilial, codprod), '[]'),
           'a', coalesce(json_agg(trim_scale(round(coalesce(qtindeniz, 0), 3)) order by codfilial, codprod), '[]'),
           'r', coalesce(json_agg(trim_scale(round(coalesce(qtreserv, 0), 3)) order by codfilial, codprod), '[]'),
           'c', coalesce(json_agg(trim_scale(round(coalesce(custofin, 0), 6)) order by codfilial, codprod), '[]'),
           'ue', coalesce(json_agg(case when dtultent is null then null else dtultent - (select b from base)::date end
                                   order by codfilial, codprod), '[]')
         ) as j
    from est0
),
prods as (
  select codprod from inventario.fato_bloqueio
  union select codprod from inventario.fato_recebimento
  union select codprod from inventario.fato_inventario
  union select codprod from est0
),
prod as (
  select p.* from inventario.produto p join prods using (codprod)
),
funcs as (
  select codfunc as m from inventario.fato_bloqueio
  union select codfunc from inventario.fato_recebimento
  union select codfunc_contagem from inventario.fato_inventario
  union select codfunc_atualizacao from inventario.fato_inventario
)
select json_build_object(
  'meta', json_build_object(
     'gerado_em',   now(),
     'base',        to_char((select b from base), 'YYYY-MM-DD'),
     'ini',         to_char(least((select min(dt) from inventario.fato_bloqueio)::date, (select min(dt) from inventario.fato_recebimento)::date,
                                  (select min(data) from inventario.fato_inventario)), 'YYYY-MM-DD'),
     'ult_mov',     to_char(greatest((select max(dt) from inventario.fato_bloqueio), (select max(dt) from inventario.fato_recebimento)), 'YYYY-MM-DD"T"HH24:MI:SS'),
     'ult_inv',     to_char((select max(coalesce(dt_atualizacao, dt_contagem)) from inventario.fato_inventario), 'YYYY-MM-DD"T"HH24:MI:SS'),
     'carga',       (select max(executado_em) from inventario.controle_carga where consulta = 'bloqueio' and status = 'OK'),
     'filiais',     (select json_agg(distinct codfilial) from inventario.fato_posicao)
  ),
  'filiais', (select coalesce(json_agg(json_build_array(f.codfilial, coalesce(f.fantasia, f.razao_social), f.cidade, f.uf) order by f.codfilial), '[]')
                from inventario.filial f
               where f.codfilial in (select codfilial from inventario.fato_posicao union select codfilial from inventario.fato_bloqueio
                                     union select codfilial from inventario.fato_recebimento
                                     union select codfilial from inventario.fato_inventario)),
  'motivos', (select coalesce(json_agg(json_build_array(x.coddevol, x.motivo) order by x.coddevol), '[]') from (
                select m.coddevol, m.motivo from inventario.motivo m
                 where m.coddevol in (select coddevol from inventario.fato_bloqueio)
                union all
                select 30, 'LIBERAÇÃO DO WMS (ARMAZENAGEM)'
                 where not exists (select 1 from inventario.motivo where coddevol = 30)
                   and exists (select 1 from inventario.fato_bloqueio where coddevol = 30)) x),
  'funcs',   (select coalesce(json_agg(json_build_array(e.matricula, coalesce(e.nome, 'Matrícula ' || e.matricula), e.funcao) order by e.matricula), '[]')
                from inventario.funcionario e where e.matricula in (select m from funcs)),
  'produtos', (select coalesce(json_agg(json_build_array(codprod, descricao, embalagem, coalesce(codfornec, -1), coalesce(codepto, -1),
                                                         coalesce(codsec, -1), unidade, case when fora_de_linha then 1 else 0 end) order by codprod), '[]')
                 from prod),
  'fornecedores', (select coalesce(json_agg(json_build_array(codfornec, fornecedor) order by codfornec), '[]')
                     from (select distinct on (codfornec) codfornec, fornecedor from prod where codfornec is not null order by codfornec) x),
  'deptos',  (select coalesce(json_agg(json_build_array(codepto, departamento) order by codepto), '[]')
                from (select distinct on (codepto) codepto, departamento from prod where codepto is not null order by codepto) x),
  'secoes',  (select coalesce(json_agg(json_build_array(codsec, secao, codepto) order by codsec), '[]')
                from (select distinct on (codsec) codsec, secao, codepto from prod where codsec is not null order by codsec) x),
  -- produtos com foto: leitura (não carga) da miniatura que o Gestão Comercial guarda; a
  -- função api/img serve a foto de lá. Cruzar schemas na LEITURA é permitido pelo padrão.
  'fotos', (select coalesce(json_agg(m.codprod order by m.codprod), '[]')
              from trade.produto_miniatura m where m.codprod in (select codprod from prods)),
  'ev',  (select j from ev),
  'inv', (select j from inv),
  'est', (select j from est)
);
$$;

comment on function inventario.painel_dados() is
  'Pacote do painel MOVIMENTAÇÃO DE INVENTÁRIO (colunas). A carga comprime e guarda em inventario.painel_cache.';
