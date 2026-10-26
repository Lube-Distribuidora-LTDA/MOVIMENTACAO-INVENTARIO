# Movimentação de Inventário — Lube Distribuidora

Painel de tudo o que mexe no estoque do galpão, a partir de duas rotinas do WinThor:

| Rotina | Nome no WinThor | De onde vem |
|---|---|---|
| **266** | Bloquear Produtos no Estoque | `PCLOGDESBLOQUEIO` — o livro de tudo o que entra e sai do estoque **bloqueado**: bloqueio e desbloqueio manual, avaria, devolução de cliente que entra bloqueada (1303/1346/1361), liberação do WMS da Kaizen depois da armazenagem, cancelamento de devolução (1316) |
| **1147** | Manutenção de inventário rotativo | `PCINVENTROT` (o que foi contado) + `PCLOGATUALIZAINVENT` (a diferença que a atualização lançou: EI = sobra, SI = falta) |
| **1301** | Entrada de mercadoria (recebimento de compra) | `PCMOV` E/EB/ER: o recebimento entra **bloqueado** até o WMS armazenar, e o livro da 266 só registra a liberação; quanto entrou bloqueado está na própria linha da nota (`PCMOV.QTBLOQUEADA`) |

Mais o `PCEST` de hoje (estoque, bloqueado, avaria e custo) para o "bloqueado hoje" e para dar valor aos movimentos.

Caminho, como todo BI da casa: **WinThor (Oracle) → ETL em Python (VM `SRV-IA`) → Supabase, projeto DATA WAREHOUSE, schema `inventario` → painel (Vercel)**.

## Estrutura

```
etl/        carga (Python)
  bi_comum.py               infraestrutura comum (mesma do REPOSIÇÕES): ENV, conexões, carga, tranca, controle_carga
  consultas_inventario.py   catálogo: 8 consultas, uma por tabela de destino
  sync_inventario.py        orquestrador: consultas → conferência 1147 × PCMOV → pacote do painel
  diagnostico_inventario.py roda tudo SEM GRAVAR e confere a 1147 contra o PCMOV mês a mês
  conferir_recebimento.py   prova, SEM GRAVAR, que o recebimento entra bloqueado (foto diária do estoque, PCHISTEST)
  executar.py               porta de entrada do Agendador (erro antes do log vai para falha_inicial.log)
  instalar_e_agendar.ps1    instala em C:\BI\INVENTARIO e cria a tarefa "Inventario - Sync"
  INSTALAR TUDO.bat · ATUALIZAR AGORA.bat · DIAGNOSTICO.bat · LEIA-ME.txt · ENV.example
web/        painel
  index.html, css/, js/     telas (o navegador filtra e soma tudo)
  api/dados.js              entrega o pacote comprimido guardado no banco
  api/versao.js             o que há de novo: pacote da carga, pacote do dia, agente ligado, pedido do Atualizar
  api/hoje.js               entrega o pacote do dia (montado pelo AGENTE LUBE), comprimido
  api/atualizar.js          botão Atualizar: pede ao agente uma leitura do WinThor agora (POST)
  api/img.js                foto do produto (miniatura que o Gestão Comercial já guarda)
  db/                       migrações do schema `inventario` (01 a 08; 01 e 02 são a definição vigente das tabelas, views e função)
  servidor_local.js         abre o painel no computador, contra o banco de verdade
  middleware.ts + sentinela-guarda.ts   guarda da Sentinela (só entra quem tem acesso pelo Painel Lube)
INICIAR.bat  abre o painel nesta máquina (http://localhost:3102)
```

## O banco (schema `inventario`, DATA WAREHOUSE)

| Tabela | Conteúdo | Carga |
|---|---|---|
| `fato_bloqueio` | um registro por movimento do bloqueado, como o WinThor gravou | TRUNCATE + INSERT, em lotes |
| `fato_recebimento` | uma linha do PCMOV por produto recebido na 1301 (QT, QTBLOQUEADA, estorno do cancelamento com QT negativa), com a hora de lançamento da nota | TRUNCATE + INSERT |
| `fato_inventario` | um registro por produto contado na 1147 (com a diferença do log) | TRUNCATE + INSERT |
| `fato_posicao` | PCEST de hoje: estoque, bloqueado, avaria, custo financeiro | TRUNCATE + INSERT |
| `produto`, `funcionario`, `motivo`, `filial` | cadastros | upsert |
| `controle_carga` | um registro por passo de cada carga | — |
| `painel_cache` | o pacote do painel, comprimido (gzip) | refeito em toda carga |
| `painel_hoje_cache` | o pacote do dia (texto JSON; a API comprime) | refeito pelo AGENTE LUBE depois de gravar |

Toda tabela com **RLS ligado e sem políticas**: a chave pública não lê nada.

- `vw_movimento` — o livro lido do jeito certo (ver "Como o livro da 266 é lido"), mais o recebimento de compra.
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
| 1301 (não está no livro: vem do `PCMOV`) | recebimento de compra, que entra bloqueado | `PCMOV.QTBLOQUEADA` (= `QT` em 99,8% das linhas; `ESTOQUEDESBLOQUEADO = 'S'` = entrou livre); o estorno do cancelamento vem com `QT` negativa |

Tipos no painel: bloqueio manual, bloqueio por avaria, avaria registrada, desbloqueio manual, baixa de avaria, liberação pelo WMS, devolução de cliente / avulsa / de simples remessa, devolução cancelada, desbloqueio automático, montagem, **recebimento de compra** (entra no bloqueado), **recebimento cancelado** e **recebimento sem bloqueio** (os dois neutros). Programa desconhecido vira "Outro" (nada some); o diagnóstico avisa programa novo.

**Por que o recebimento cancelado é neutro:** o estorno tira do bloqueado só se a mercadoria ainda não tinha sido liberada (na filial 1, 81% das vezes; na 12, 44%), e nem o livro nem o PCMOV dizem qual foi o caso. A tela mostra o valor à parte, sem somar em "entrou" nem em "saiu".

## Validação

- **1147 × PCMOV:** a diferença de cada produto (log da atualização) bate com os EI/SI que a própria 1147 lançou no PCMOV, **mês a mês, quantidade e valor**, desde jan/2025. A carga refaz essa conferência sempre (`conferencia_1147` em `controle_carga`).
- **Tela × banco:** contagem, SKUs e valor de um recorte (bloqueios da filial 1 em 2026) iguais ao centavo; bloqueado de hoje igual ao PCEST por filial; sobra e falta de 2026 iguais ao log do WinThor ao centavo.
- **Recebimento × foto diária do estoque** (`conferir_recebimento.py`, set/2025 a out/2026): para cada produto, a variação do bloqueado entre as fotos de fim de mês (`PCHISTEST`) contra o livro + o recebimento. Somar o recebimento derruba o que fica sem explicação de 35,6 mi para 4,5 mi de unidades na filial 1 (filial 10: de 467 mil para 0; 7: 1,6 mi → 278 mil; 12: 1,7 mi → 260 mil); só 0,4% dos produto × mês da filial 1 fecham *sem* o recebimento. O que sobra é do próprio livro, não do recebimento.
- **Tela × banco do recebimento (2026-10-20):** filial 1 em 2026 — 22.046 linhas, 28.815.075,329 un., R$ 87.988.623,75, 4.259 notas, tempo mediano de armazenagem 7,3 h (1.876 notas) — iguais ao centavo à consulta na `vw_movimento`.

## Decisões conscientes (e o que elas significam na tela)

- **Valor dos movimentos = quantidade × custo financeiro de HOJE.** O livro de bloqueio não guarda custo. O inventário usa o valor que a própria 1147 lançou.
- **O recebimento de compra (1301) entra bloqueado, e o livro da 266 só registra a LIBERAÇÃO** (pelo WMS, ou na 266 com o motivo "Conferido pelo recebimento"). Desde 2026-10-20 o painel lê a entrada da própria nota (`PCMOV.QTBLOQUEADA`), conferida contra a foto diária do estoque. Mesmo assim o painel continua sem "saldo" do período: o livro tem outras falhas (o WMS às vezes grava liberação que não mexe no saldo), e o bloqueado de hoje vem do PCEST.
- **Hora do recebimento = hora de lançamento da nota** (`PCNFENT.DTENT` + `HORALANC` + `MINUTOLANC`, sem o CT do frete). A hora do `PCMOV` vem em lotes (08:12, 16:01…) e fecha pior com a foto do estoque.
- **Tempo de armazenagem do recebimento** = da nota lançada até a última liberação do WMS **da mesma transação**, só nas notas que o WMS liberou por inteiro. O WMS às vezes libera uma carga com várias notas citando a transação de só uma delas (ex.: a 1167170 liberou produtos da 1167167), e nas filiais sem WMS a liberação é manual na 266 — por isso só 44% das notas da filial 1 em 2026 entram na mediana.
- **O recebimento não conta como "último bloqueio"** na tela Bloqueado hoje: entra e sai em horas e esconderia a idade do que ficou parado.
- **Movimento suspeito fica fora das somas, com aviso:** quantidade de 1 milhão de unidades ou mais num registro só. Caso real: o recebimento de 17 paletes (cód. 9711, transação 918016) lançado com 17.000.000 **bloqueados** em 27/06/2025 — a foto do estoque confirma o salto, no bloqueado e no estoque — e desbloqueado na 266 em 04/07/2025 (17.000.043); o estoque já estava certo em 01/08/2025. Um botão inclui nas somas; a correção é no WinThor.
- **Filiais 1, 7, 10, 11 e 12** (as de distribuição). O PCEST das filiais 3, 4 e 6 guarda valores "bloqueados" que não são mercadoria de galpão. Ajustável no ENV (`INVENTARIO_FILIAIS`).
- **Histórico desde 2025-01-01** (`INVENTARIO_DATA_INICIAL`): dá a comparação com o ano anterior.
- **Cadastro de produto próprio (`inventario.produto`).** O `core.dim_produto` (dono: BI COMPRAS) não tem departamento, seção nem embalagem. Quando o dono ganhar essas colunas, este sistema passa a ler de lá.
- **O navegador filtra e soma** (como no REPOSIÇÕES): ~200 mil movimentos e uma dezena de filtros que se cruzam com tudo. O pacote (~9 MB) viaja comprimido (~1,2 MB), fica guardado no navegador e só é baixado de novo quando a carga gera outro.

## O painel

Telas: **Visão geral** · **Bloqueios e avarias** (266) · **Recebimento e devoluções** (1301, 1303/1346/1361 e WMS: o tempo de armazenagem do recebimento e o tempo até o WMS liberar cada devolução) · **Bloqueado hoje** (com "há quanto tempo está bloqueado") · **Inventário rotativo** (1147: acurácia, sobra, falta, quem contou, produtos que sempre divergem) · **Análise livre** (linhas × colunas × medida, em movimentos, inventário ou bloqueado) · **Movimentações** (linha a linha).

No padrão da casa: filtros de múltipla escolha com busca (vazio = todos), períodos rápidos e datas livres, comparação com o período anterior e o ano anterior, **todo clique abre o relatório do recorte** (com Voltar; Ctrl+clique filtra), foto do produto, Excel formatado com os filtros escritos, link da visão, tema claro/escuro, modo apresentação (F).

### Ao vivo e o botão Atualizar (AGENTE LUBE, desde 2026-10-26)

O **AGENTE LUBE** (`Desktop\BI\22. AGENTE LUBE`, na `SRV-IA`) lê o WinThor de segundos em segundos e grava só a diferença nas tabelas deste schema. Depois de gravar, roda `inventario.atualizar_painel_hoje()` (`db/08-painel-hoje.sql`), que monta o **pacote do dia** — movimentos de ontem e hoje, posição inteira, inventários de 30 dias, no mesmo formato do pacote da carga — no máximo de 10 em 10 s (~110 ms, ~100 KB comprimido).

- **A tela muda sozinha.** De 15 em 15 s, com a aba à vista, o painel pergunta `/api/versao`; se o pacote do dia mudou, baixa só ele (`/api/hoje`) e soma ao da carga: até anteontem vale a carga, de ontem em diante o do dia. Redesenha sem animar, no mesmo filtro e período; com relatório ou lista aberta, espera fechar. A carga da manhã também entra sozinha, sem recarregar a página.
- **O botão Atualizar é a ponte.** `/api/atualizar` grava um pedido (`agente.pedir_atualizacao`, que avisa o agente por `NOTIFY`); o agente lê o WinThor na hora, monta o pacote e responde em `agente.pedido` com o que mudou. O painel mostra "WinThor lido agora (1,5 s): 20 posições de estoque mudaram". O painel nunca fala com o Oracle.
- **Sem o agente,** tudo é como antes: indicador cinza "Carga das HH:MM", e o Atualizar avisa e confere a carga.
- Indicador ao lado do Atualizar: verde **"Ao vivo · hh:mm:ss"** com o agente ligado.

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

Agendamento (na VM `SRV-IA`): `P:\INTEGRAÇÃO BI\INVENTARIO\INSTALAR TUDO.bat`. **Carga só às 07:05** desde 2026-10-26 (decisão do Júlio): durante o dia o AGENTE LUBE mantém o painel ao vivo; a carga da manhã pega a noite e refaz o histórico, o pacote do painel e a conferência da 1147 (até então eram 8, de 07:05 a 22:05). "A carga entrou?" se responde em `inventario.controle_carga`, nunca pelo log da tela.

## Vercel

Root Directory `web`, Framework Other, sem build, região `gru1`. Variáveis (cadastradas pelo Júlio, porta **5432**): `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`. Guarda da Sentinela com `exige_login` (projeto `movimentacao-inventario`).

## Acesso

O painel tem nome de funcionário e valor de estoque: **só abre para quem tem acesso pelo Painel Lube** (guarda da Sentinela). Senha, IP interno e dado de pessoa nunca entram neste repositório.
