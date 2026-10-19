# Movimentação de Inventário — Lube Distribuidora

Painel de tudo o que mexe no estoque do galpão, a partir de duas rotinas do WinThor:

| Rotina | Nome no WinThor | De onde vem |
|---|---|---|
| **266** | Bloquear Produtos no Estoque | `PCLOGDESBLOQUEIO` — o livro de tudo o que entra e sai do estoque **bloqueado**: bloqueio e desbloqueio manual, avaria, devolução de cliente que entra bloqueada (1303/1346/1361), liberação do WMS da Kaizen depois da armazenagem, cancelamento de devolução (1316) |
| **1147** | Manutenção de inventário rotativo | `PCINVENTROT` (o que foi contado) + `PCLOGATUALIZAINVENT` (a diferença que a atualização lançou: EI = sobra, SI = falta) |

Mais o `PCEST` de hoje (estoque, bloqueado, avaria e custo) para o "bloqueado hoje" e para dar valor aos movimentos.

Caminho, como todo BI da casa: **WinThor (Oracle) → ETL em Python (VM `SRV-IA`) → Supabase, projeto DATA WAREHOUSE, schema `inventario` → painel (Vercel)**.

## Estrutura

```
etl/        carga (Python)
  bi_comum.py               infraestrutura comum (mesma do REPOSIÇÕES): ENV, conexões, carga, tranca, controle_carga
  consultas_inventario.py   catálogo: 7 consultas, uma por tabela de destino
  sync_inventario.py        orquestrador: consultas → conferência 1147 × PCMOV → pacote do painel
  diagnostico_inventario.py roda tudo SEM GRAVAR e confere a 1147 contra o PCMOV mês a mês
  executar.py               porta de entrada do Agendador (erro antes do log vai para falha_inicial.log)
  instalar_e_agendar.ps1    instala em C:\BI\INVENTARIO e cria a tarefa "Inventario - Sync"
  INSTALAR TUDO.bat · ATUALIZAR AGORA.bat · DIAGNOSTICO.bat · LEIA-ME.txt · ENV.example
web/        painel
  index.html, css/, js/     telas (o navegador filtra e soma tudo)
  api/dados.js              entrega o pacote comprimido guardado no banco
  api/versao.js             diz qual pacote está no banco (o navegador só baixa se mudou)
  api/img.js                foto do produto (miniatura que o Gestão Comercial já guarda)
  db/                       migrações do schema `inventario` (01 a 06; 02 é a definição vigente das views e da função)
  servidor_local.js         abre o painel no computador, contra o banco de verdade
  middleware.ts + sentinela-guarda.ts   guarda da Sentinela (só entra quem tem acesso pelo Painel Lube)
INICIAR.bat  abre o painel nesta máquina (http://localhost:3102)
```

## O banco (schema `inventario`, DATA WAREHOUSE)

| Tabela | Conteúdo | Carga |
|---|---|---|
| `fato_bloqueio` | um registro por movimento do bloqueado, como o WinThor gravou | TRUNCATE + INSERT, em lotes |
| `fato_inventario` | um registro por produto contado na 1147 (com a diferença do log) | TRUNCATE + INSERT |
| `fato_posicao` | PCEST de hoje: estoque, bloqueado, avaria, custo financeiro | TRUNCATE + INSERT |
| `produto`, `funcionario`, `motivo`, `filial` | cadastros | upsert |
| `controle_carga` | um registro por passo de cada carga | — |
| `painel_cache` | o pacote do painel, comprimido (gzip) | refeito em toda carga |

Toda tabela com **RLS ligado e sem políticas**: a chave pública não lê nada.

- `vw_movimento` — o livro lido do jeito certo (ver "Como o livro da 266 é lido").
- `vw_inventario` — a 1147 com a diferença assinada (+ sobra, − falta).
- `painel_dados()` — o pacote inteiro em colunas (um array por campo). Lê `trade.produto_miniatura` **só** para saber quais produtos têm foto (cruzar schemas na leitura é permitido; este sistema não escreve fora do próprio schema).

Mudou uma view ou a função? Aplique e rode `python sync_inventario.py --so-pacote`.

## Como o livro da 266 é lido

Cada programa grava os campos de um jeito. Conferido produto a produto contra o saldo do PCEST:

| Programa | O que é | Quantidade |
|---|---|---|
| `PCSIS266` (sem versão) | bloqueio feito na 266 | `QTBLOQUEADA` = quanto bloqueou; `QTINDENIZ` = quanto disso é avaria; `QTDESBLOQUEADA` = desbloqueio (de avaria) |
| `[PCSIS266 - versão]` | desbloqueio feito na 266 | `QTDESBLOQUEADA`; o `QTBLOQUEADA` é o saldo **depois** |
| `WMS DA KAIZEN SOLUTIONS` | liberação depois da armazenagem | `QTDESBLOQUEADA` |
| 1303 / 1346 / 1361 | devolução de cliente (entra bloqueada) | `QTBLOQUEADA`; motivo = motivo da devolução |
| 1316 | cancelamento da devolução | estorna a **entrada**; não muda o bloqueado (neutro) |
| 552 (até mai/2025) | desbloqueio automático | `QTDESBLOQUEADA` |
| 1122 | montagem de produtos | `QTBLOQUEADA` |

Tipos no painel: bloqueio manual, bloqueio por avaria, avaria registrada, desbloqueio manual, baixa de avaria, liberação pelo WMS, devolução de cliente / avulsa / de simples remessa, devolução cancelada, desbloqueio automático, montagem. Programa desconhecido vira "Outro" (nada some); o diagnóstico avisa programa novo.

## Validação

- **1147 × PCMOV:** a diferença de cada produto (log da atualização) bate com os EI/SI que a própria 1147 lançou no PCMOV, **mês a mês, quantidade e valor**, desde jan/2025. A carga refaz essa conferência sempre (`conferencia_1147` em `controle_carga`).
- **Tela × banco:** contagem, SKUs e valor de um recorte (bloqueios da filial 1 em 2026) iguais ao centavo; bloqueado de hoje igual ao PCEST por filial; sobra e falta de 2026 iguais ao log do WinThor ao centavo.

## Decisões conscientes (e o que elas significam na tela)

- **Valor dos movimentos = quantidade × custo financeiro de HOJE.** O livro de bloqueio não guarda custo. O inventário usa o valor que a própria 1147 lançou.
- **O recebimento de compra (1301) entra bloqueado, mas o WinThor só registra a LIBERAÇÃO** (pelo WMS, ou na 266 com o motivo "Conferido pelo recebimento"). Por isso, no livro, sai do bloqueado muito mais do que entra. O painel não mostra "saldo" do período; mostra o bloqueado de hoje (PCEST).
- **Movimento suspeito fica fora das somas, com aviso:** quantidade de 1 milhão de unidades ou mais num registro só. Caso real: 17.000.043 paletes desbloqueados de uma vez em 04/07/2025 (erro de digitação). Um botão inclui nas somas; a correção é no WinThor.
- **Filiais 1, 7, 10, 11 e 12** (as de distribuição). O PCEST das filiais 3, 4 e 6 guarda valores "bloqueados" que não são mercadoria de galpão. Ajustável no ENV (`INVENTARIO_FILIAIS`).
- **Histórico desde 2025-01-01** (`INVENTARIO_DATA_INICIAL`): dá a comparação com o ano anterior.
- **Cadastro de produto próprio (`inventario.produto`).** O `core.dim_produto` (dono: BI COMPRAS) não tem departamento, seção nem embalagem. Quando o dono ganhar essas colunas, este sistema passa a ler de lá.
- **O navegador filtra e soma** (como no REPOSIÇÕES): ~200 mil movimentos e uma dezena de filtros que se cruzam com tudo. O pacote (~9 MB) viaja comprimido (~1,2 MB), fica guardado no navegador e só é baixado de novo quando a carga gera outro.

## O painel

Telas: **Visão geral** · **Bloqueios e avarias** (266) · **Devoluções e WMS** (com o tempo até o WMS liberar cada devolução) · **Bloqueado hoje** (com "há quanto tempo está bloqueado") · **Inventário rotativo** (1147: acurácia, sobra, falta, quem contou, produtos que sempre divergem) · **Análise livre** (linhas × colunas × medida, em movimentos, inventário ou bloqueado) · **Movimentações** (linha a linha).

No padrão da casa: filtros de múltipla escolha com busca (vazio = todos), períodos rápidos e datas livres, comparação com o período anterior e o ano anterior, **todo clique abre o relatório do recorte** (com Voltar; Ctrl+clique filtra), foto do produto, Excel formatado com os filtros escritos, link da visão, tema claro/escuro, modo apresentação (F).

## Rodar

```
cd etl
python diagnostico_inventario.py     # sem gravar
python sync_inventario.py            # carga completa (~30 s)
python sync_inventario.py --so-pacote
cd ..\web
npm install
node servidor_local.js               # http://localhost:3102
```

Agendamento (na VM `SRV-IA`): `P:\INTEGRAÇÃO BI\INVENTARIO\INSTALAR TUDO.bat`. Cargas às 07:05, 09:05, 11:05, 13:05, 15:05, 17:05, 19:05 e 22:05. "A carga entrou?" se responde em `inventario.controle_carga`, nunca pelo log da tela.

## Vercel

Root Directory `web`, Framework Other, sem build, região `gru1`. Variáveis (cadastradas pelo Júlio, porta **5432**): `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`. Guarda da Sentinela com `exige_login` (projeto `movimentacao-inventario`).

## Acesso

O painel tem nome de funcionário e valor de estoque: **só abre para quem tem acesso pelo Painel Lube** (guarda da Sentinela). Senha, IP interno e dado de pessoa nunca entram neste repositório.
