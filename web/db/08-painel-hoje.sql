-- =============================================================================
-- MOVIMENTAÇÃO DE INVENTÁRIO — pacote do dia, ao vivo (migração inventario_08_painel_hoje)
-- 2026-10-26. Depende do schema `agente` (AGENTE LUBE, Desktop\BI\22. AGENTE LUBE).
--
-- O AGENTE LUBE mantém as tabelas deste schema em dia de segundos em segundos (livro e
-- recebimento de ontem e hoje, posição inteira, inventários de 30 dias). Depois de gravar,
-- ele roda inventario.atualizar_painel_hoje(), que monta o PACOTE DO DIA e guarda em
-- inventario.painel_hoje_cache. O navegador soma esse pacote ao pacote da carga
-- (painel_dados, de 2 em 2 horas): o que é de antes de ontem vem da carga; de ontem em
-- diante, do pacote do dia. A tela muda sozinha, sem F5.
--
-- O pacote do dia tem o MESMO formato do pacote da carga (colunas, mesma ordem), com três
-- diferenças: os movimentos trazem 't' (minutos desde meta.base) em vez de 'dt' (diferença
-- para o anterior); meta.corte_t diz a partir de que minuto ele substitui a carga; e os
-- cadastros vêm só para o que o próprio pacote cita.
--
-- Não muda nada do que já existe: o pacote da carga, as views e a tela publicada seguem iguais.
-- =============================================================================

create or replace function inventario.painel_hoje(p_desde date, p_inv_desde date)
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
corte as (
  select (extract(epoch from (p_desde::timestamp - (select b from base))) / 60)::bigint as t
),
-- movimentos do corte em diante, com o minuto arredondado do MESMO jeito do painel_dados:
-- o navegador tira da carga o que tem t >= corte e põe estes no lugar (nada fica duas vezes)
mov0 as (
  select m.*, (extract(epoch from (m.dt - (select b from base))) / 60)::bigint as t
    from inventario.vw_movimento m
   where m.dt >= p_desde::timestamp - interval '1 minute'
),
mov as (
  select mov0.*, row_number() over (order by mov0.dt, mov0.codfilial, mov0.codprod, mov0.tipo) as rn
    from mov0
   where mov0.t >= (select t from corte)
),
ev as (
  select json_build_object(
           'n',  count(*),
           't',  coalesce(json_agg(t order by rn), '[]'),
           'f',  coalesce(json_agg(codfilial order by rn), '[]'),
           'p',  coalesce(json_agg(codprod order by rn), '[]'),
           'u',  coalesce(json_agg(coalesce(codfunc, 0) order by rn), '[]'),
           'm',  coalesce(json_agg(coalesce(coddevol, -1) order by rn), '[]'),
           'k',  coalesce(json_agg(tipo order by rn), '[]'),
           'q',  coalesce(json_agg(trim_scale(round(qt, 3)) order by rn), '[]'),
           'a',  coalesce(json_agg(trim_scale(round(qt_avaria, 3)) order by rn), '[]'),
           'd',  coalesce(json_agg(coalesce(numtransent, 0) order by rn), '[]')
         ) as j
    from mov
),
-- inventários montados, contados, atualizados ou cancelados desde p_inv_desde: substituem,
-- pela chave (inventário, filial, produto), a mesma linha da carga
invr as (
  select v.*, row_number() over (order by v.data, v.numinvent, v.codprod) as rn
    from inventario.vw_inventario v
   where v.data >= p_inv_desde or v.dt_contagem >= p_inv_desde
      or v.dt_atualizacao >= p_inv_desde or v.dt_cancel >= p_inv_desde
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
           'v',  coalesce(json_agg(trim_scale(round(vl_ajuste, 6)) order by rn), '[]'),
           's',  coalesce(json_agg(case situacao when 'atualizado' then 0 when 'em contagem' then 1 else 2 end order by rn), '[]')
         ) as j
    from invr
),
-- posição inteira (9 mil linhas): substitui a da carga
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
    from inventario.fato_posicao
),
-- cadastros: só o que este pacote cita e a carga pode não ter (produto que entrou hoje)
prods as (
  select codprod from mov
  union select codprod from invr
  union select codprod from inventario.fato_posicao where dtultent >= p_desde - 1
),
prod as (
  select p.* from inventario.produto p join prods using (codprod)
),
funcs as (
  select codfunc as m from mov
  union select codfunc_contagem from invr
  union select codfunc_atualizacao from invr
)
select json_build_object(
  'meta', json_build_object(
     'gerado_em', now(),
     'base',      to_char((select b from base), 'YYYY-MM-DD'),
     'desde',     to_char(p_desde, 'YYYY-MM-DD'),
     'corte_t',   (select t from corte),
     'inv_desde', to_char(p_inv_desde, 'YYYY-MM-DD'),
     'ult_mov',   to_char(greatest((select max(dt) from inventario.fato_bloqueio), (select max(dt) from inventario.fato_recebimento)), 'YYYY-MM-DD"T"HH24:MI:SS'),
     'ult_inv',   to_char((select max(coalesce(dt_atualizacao, dt_contagem)) from inventario.fato_inventario), 'YYYY-MM-DD"T"HH24:MI:SS')
  ),
  'filiais', (select coalesce(json_agg(json_build_array(f.codfilial, coalesce(f.fantasia, f.razao_social), f.cidade, f.uf) order by f.codfilial), '[]')
                from inventario.filial f
               where f.codfilial in (select codfilial from mov union select codfilial from invr union select codfilial from inventario.fato_posicao)),
  'motivos', (select coalesce(json_agg(json_build_array(x.coddevol, x.motivo) order by x.coddevol), '[]') from (
                select m.coddevol, m.motivo from inventario.motivo m
                 where m.coddevol in (select coddevol from mov)
                union all
                select 30, 'LIBERAÇÃO DO WMS (ARMAZENAGEM)'
                 where not exists (select 1 from inventario.motivo where coddevol = 30)
                   and exists (select 1 from mov where coddevol = 30)) x),
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
  'fotos', (select coalesce(json_agg(m.codprod order by m.codprod), '[]')
              from trade.produto_miniatura m where m.codprod in (select codprod from prods)),
  'ev',  (select j from ev),
  'inv', (select j from inv),
  'est', (select j from est)
);
$$;

comment on function inventario.painel_hoje(date, date) is
  'Pacote do dia do painel MOVIMENTAÇÃO DE INVENTÁRIO: movimentos de p_desde em diante, inventários tocados desde p_inv_desde e a posição inteira, no formato do painel_dados. O navegador soma ao pacote da carga.';

-- ----------------------------------------------------------------------------- onde fica pronto
-- Texto, não gzip (o Postgres não tem gzip): o TOAST comprime no disco e a API comprime
-- na hora de entregar. Uma linha só, trocada a cada montagem.
create table if not exists inventario.painel_hoje_cache (
  id          smallint primary key default 1 check (id = 1),
  gerado_em   timestamptz not null default now(),
  versao      text not null,
  desde       date not null,
  bytes_json  integer,
  ms          integer,
  payload     text not null
);
alter table inventario.painel_hoje_cache enable row level security;
comment on table inventario.painel_hoje_cache is
  'Pacote do dia do painel (inventario.painel_hoje), montado pelo AGENTE LUBE depois de gravar (agente.sistema.apos_gravar). A API /api/hoje entrega comprimido.';

-- Monta o pacote do dia (ontem e hoje; inventários de 30 dias, as janelas do agente) e guarda.
-- "Hoje" é o de Brasília: o banco roda em UTC e o WinThor grava a hora local.
create or replace function inventario.atualizar_painel_hoje()
returns text
language plpgsql
set search_path = inventario, pg_temp
as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_inicio timestamptz := clock_timestamp();
  v_json   text;
  v_versao text;
begin
  v_json := inventario.painel_hoje(v_hoje - 1, v_hoje - 30)::text;
  v_versao := to_char(clock_timestamp() at time zone 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS-MS');
  insert into inventario.painel_hoje_cache (id, gerado_em, versao, desde, bytes_json, ms, payload)
  values (1, now(), v_versao, v_hoje - 1, octet_length(v_json),
          (extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, v_json)
  on conflict (id) do update set gerado_em = excluded.gerado_em, versao = excluded.versao, desde = excluded.desde,
         bytes_json = excluded.bytes_json, ms = excluded.ms, payload = excluded.payload;
  return v_versao;
end;
$$;

comment on function inventario.atualizar_painel_hoje() is
  'Monta o pacote do dia do painel e guarda em inventario.painel_hoje_cache. Quem chama: o AGENTE LUBE, depois de gravar no schema inventario (agente.sistema.apos_gravar).';

revoke all on function inventario.painel_hoje(date, date) from public;
revoke all on function inventario.atualizar_painel_hoje() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function inventario.painel_hoje(date, date) from anon, authenticated;
    revoke all on function inventario.atualizar_painel_hoje() from anon, authenticated;
  end if;
end $$;

-- ----------------------------------------------------------------------------- o agente monta depois de gravar
insert into agente.sistema (sistema, versao, apos_gravar, apos_gravar_s)
values ('inventario', '', 'select inventario.atualizar_painel_hoje()', 10)
on conflict (sistema) do update set apos_gravar = excluded.apos_gravar, apos_gravar_s = excluded.apos_gravar_s;
