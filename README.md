# Moodle Deadlines Dashboard

Aplicação **local** que junta os prazos do Moodle num só painel: eventos do
calendário oficial e datas de avaliação que só aparecem dentro de ficheiros das
cadeiras (PPTX, PDF e, opcionalmente, DOCX).

O problema que resolve: muitas datas de testes, exames e entregas **não estão no
calendário do Moodle** — estão em slides e documentos colocados nas páginas das
cadeiras. O dashboard combina as duas fontes e permite confirmar ou corrigir as
datas duvidosas.

> **Estado atual: Fase 4 concluída — primeira configuração na página.** A
> aplicação liga-se ao Moodle com token ou credenciais, junta os eventos do
> calendário às entregas das tarefas e mostra tudo numa interface local com
> filtros, linha temporal e vista de calendário. Descarrega os PDF e PPTX das
> cadeiras, extrai o texto (com cache), procura datas de avaliação e apresenta-as
> como sugestões **por rever**. Cada sugestão pode ser confirmada, corrigida ou
> descartada, e a decisão fica guardada localmente. Se ainda não existir `.env`,
> a própria página pede o ano letivo, o número de aluno e a palavra-passe, obtém
> um token e cria o ficheiro.

## Para quem não é de Engenharia Informática

Esta secção explica, sem pressupor conhecimentos de programação, o que é preciso
para pôr a aplicação a funcionar. Se já conheces Node.js, podes saltar para
[Requisitos](#requisitos).

### O que é o Node.js?

O **Node.js** é um programa gratuito que corre JavaScript no computador, fora do
navegador. Normalmente o JavaScript só funciona dentro de páginas web; o Node.js
permite usá-lo para criar aplicações que correm no teu próprio computador — é o
caso deste dashboard.

Pensa nele como o **motor** que executa a aplicação: o dashboard não é um
programa que se instala com duplo clique, é um conjunto de ficheiros de código que
precisa do Node.js para arrancar. Quando executas `npm start`, estás a pedir ao
Node.js que ligue o servidor local que mostra a página no navegador.

O **npm** (vem incluído no Node.js) é o gestor de pacotes: serve para instalar
bibliotecas de que o projeto precise. Neste projeto não há dependências externas,
mas `npm install` continua a ser o primeiro passo normal.

O dashboard corre **só no teu computador** e não é publicado na Internet. Os dados
do Moodle e as tuas credenciais ficam guardados localmente.

### Instalar o Node.js

Instala a versão **LTS (Long Term Support)**, que é a mais estável. A versão tem
de ser **20.12 ou superior**.

- **Windows e macOS:** descarrega o instalador em
  [nodejs.org](https://nodejs.org) e segue os passos (aceitar as opções por
  omissão é suficiente).
- **Linux:** usa o gestor de pacotes da distribuição ou o instalador de
  [nodejs.org](https://nodejs.org). Por exemplo, em Ubuntu/Debian, a forma mais
  simples de garantir uma versão recente é seguir as instruções oficiais da
  página de downloads.

Depois de instalar, abre um terminal (no Windows: **Prompt de Comando** ou
**PowerShell**; no macOS: **Terminal**; no Linux: o terminal da distribuição) e
escreve:

```bash
node --version
npm --version
```

Se aparecerem dois números de versão (por exemplo `v20.12.0` e `10.x.x`), a
instalação correu bem. Se aparecer uma mensagem de erro, fecha e volta a abrir o
terminal; se continuar, reinstala o Node.js.

### Correr o projeto

1. **Obter o código.** Se ainda não tens a pasta do projeto, descarrega-a do
   GitHub (botão **Code → Download ZIP**) e descomprime-a, ou usa o Git:

   ```bash
   git clone <URL-do-repositório>
   cd MoodleDeadlinesDashboard
   ```

2. **Entrar na pasta do projeto.** No terminal, usa `cd` para ir até à pasta que
   contém o ficheiro `package.json`. Por exemplo, no Windows:

   ```bash
   cd C:\Users\o-teu-nome\Downloads\MoodleDeadlinesDashboard
   ```

   Dica: podes escrever `cd ` (com um espaço) e arrastar a pasta para o terminal,
   que o caminho é preenchido automaticamente.

3. **Instalar o que for necessário.** Dentro dessa pasta, executa:

   ```bash
   npm install
   ```

   Este passo só é preciso na primeira vez (ou quando o projeto for atualizado).

4. **Arrancar a aplicação:**

   ```bash
   npm start
   ```

   O terminal mostra uma mensagem a indicar que o servidor está a correr. **Deixa
   esta janela aberta** — se a fechares, a aplicação para.

5. **Abrir no navegador.** Vai a [http://127.0.0.1:3000](http://127.0.0.1:3000).
   Na primeira vez aparece o assistente para ligar ao Moodle; segue as
   instruções no ecrã (ver [Primeira configuração](#primeira-configuração-fase-4)).

6. **Parar a aplicação.** Volta ao terminal e prime `Ctrl + C`. Para a usar outra
   vez, basta repetir o passo 4 (`npm start`) — não é preciso reinstalar nada.

Se algo falhar:

- **“npm não é reconhecido”** — o Node.js não está instalado ou o terminal foi
  aberto antes da instalação. Reinstala e abre um terminal novo.
- **“Porta 3000 já está a ser usada”** — há outra aplicação a usar essa porta.
  Fecha o outro programa ou define outra porta, por exemplo
  `PORT=3001 npm start` (no Windows PowerShell:
  `$env:PORT=3001; npm start`), e abre `http://127.0.0.1:3001`.
- **A página não abre** — confirma que o terminal continua aberto e sem erros e
  que escreveste o endereço completo, com `http://`.

## Requisitos

- Node.js **LTS, versão 20.12 ou superior** (`node --version`).
- Acesso à Internet à instância Moodle da universidade.
- Credenciais Moodle, ou (preferencialmente) um token mobile ou URL iCal.

## Instalação

```bash
git clone <URL-do-repositório>
cd MoodleDeadlinesDashboard
npm install
npm start
# abrir http://127.0.0.1:3000 e seguir o assistente
```

Se preferires configurar à mão, copia `.env.example` para `.env` e preenche os
valores antes de `npm start`:

```bash
cp .env.example .env
# editar .env e preencher MOODLE_URL e credenciais/token
npm start
```

Opcionalmente, `npm run probe` testa primeiro o que a instância Moodle suporta e
recomenda a fonte de autenticação.

Ainda não há dependências externas, mas `npm install` é seguro e necessário para
as fases seguintes.

No Windows, copia o ficheiro `.env.example` para `.env` com o Explorador de
Ficheiros ou com `copy .env.example .env`.

## Primeira configuração (Fase 4)

Quando não existe `.env`, o servidor arranca sem tentar ligar-se ao Moodle e a
página abre com o assistente **“Liga o dashboard ao Moodle”**. O formulário pede:

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| Ano letivo | Sim | Quatro dígitos, por exemplo `2627`. O URL é construído como `https://moodle.unips.pt/2627/`. O valor por omissão muda em agosto. |
| Número de aluno | Sim | O mesmo utilizador do Moodle. |
| Palavra-passe | Sim | Usada **apenas em memória** para pedir um token ao Moodle. Nunca é escrita no `.env`. |
| Início do semestre | Não | Data `AAAA-MM-DD` usada para converter “semana N”; sugerida a partir do ano letivo. |

O URL base pode ser alterado com `MOODLE_BASE_URL` (por exemplo, para outra
instituição ou para uma instalação em subdiretório). Depois de validar as
credenciais, o servidor guarda `MOODLE_URL`, `MOODLE_USERNAME` e `MOODLE_TOKEN`
no `.env`, com permissões `600` em sistemas Unix, e aplica os valores sem
reiniciar. O snapshot antigo do dashboard é removido para não mostrar dados de
outra conta; o inventário de ficheiros, o texto extraído e as decisões de revisão
são preservados.

Enquanto a configuração estiver pendente, as rotas de dados respondem `428` e a
página nem tenta carregar eventos. Para voltar a configurar, remove o `.env` e
reinicia o servidor — o assistente volta a aparecer. A palavra-passe nunca é
devolvida pela API nem aparece em `data/`, logs ou relatórios.

## Configuração do `.env`

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `MOODLE_BASE_URL` | Não | Base usada pelo assistente para construir o URL do ano letivo (por defeito `https://moodle.unips.pt`). |
| `MOODLE_URL` | Sim | URL base do Moodle, por exemplo `https://moodle.exemplo.pt`. O assistente gera `.../<ano letivo>/`. |
| `MOODLE_USERNAME` | Sim, se não houver token | Nome de utilizador Moodle. |
| `MOODLE_PASSWORD` | Sim, se não houver token | Palavra-passe Moodle. Usada apenas em memória; o assistente guarda um token em vez dela. |
| `MOODLE_TOKEN` | Não | Token de web service, se já existir. Preferível à password. |
| `MOODLE_SERVICE` | Não | Serviço usado em `/login/token.php` (por defeito `moodle_mobile_app`). |
| `MOODLE_ICAL_URL` | Não | URL de exportação iCal, se já a tiveres. Preferível à password. |
| `PORT` | Não | Porta local (por defeito `3000`). O servidor escuta só em `127.0.0.1`. |
| `SEMESTER_START` | Recomendada | Primeiro dia de aulas (`AAAA-MM-DD`) para converter “semana N” e limitar a janela de datas plausíveis. Sem ela, é usada a data atual como referência. |
| `SEMESTER_TIMEZONE` | Não | Fuso horário usado nas datas (por defeito `Europe/Lisbon`). |
| `PROBE_DELAY_MS` | Não | Pausa entre pedidos do probe (por defeito `800` ms). |
| `MOODLE_DELAY_MS` | Não | Pausa entre pedidos do cliente Moodle (por defeito `800` ms). |
| `CACHE_TTL_MINUTES` | Não | Tempo de vida do cache local do dashboard (por defeito `15`; `0` desativa). |
| `MAX_FILES_PER_COURSE` | Não | Limite de ficheiros analisados por cadeira (por defeito `40`; `0` sem limite). |
| `MAX_FILE_MB` | Não | Tamanho máximo de cada ficheiro descarregado, em MB (por defeito `20`). |
| `MAX_TOTAL_MB` | Não | Limite total descarregado por análise, em MB (por defeito `250`; `0` sem limite). |
| `LLM_ENABLED` | Não | Extração opcional com LLM (Fase 5), desativada por defeito. |

**Nunca versionar o `.env`.** O `.gitignore` já o exclui, tal como a pasta
`data/`.

## Passo 0 — saber o que o Moodle suporta

Antes de implementar o cliente, o `scripts/probe.js` testa, por ordem de
preferência:

1. **API com token** — `POST /login/token.php?service=moodle_mobile_app` e, se
   houver token, as funções `core_webservice_get_site_info`,
   `core_enrol_get_users_courses`, `core_course_get_contents`,
   `core_calendar_get_calendar_upcoming_view` e `mod_assign_get_assignments`.
2. **iCal** — página `/calendar/export.php`, URL iCal configurado em
   `MOODLE_ICAL_URL` e exportação autenticada (`export_execute.php`).
3. **Login por formulário** — `logintoken` + cookies de sessão, acesso ao painel
   e verificação do que é possível fazer por scraping.

Para o executar:

```bash
# preencher MOODLE_URL, MOODLE_USERNAME e MOODLE_PASSWORD no .env
npm run probe
```

O resultado é impresso na consola e guardado em `data/probe-report.json` (sem
credenciais, tokens ou cookies). O script faz pedidos **sequenciais**, com uma
pausa de 800 ms por defeito, para não sobrecarregar o Moodle.

Critério de decisão documentado: **API com token > iCal > scraping**. A fonte
escolhida será indicada no relatório e implementada na Fase 1. Se o probe não
encontrar nenhuma fonte, o README será atualizado com a alternativa manual
(por exemplo, colar um URL iCal em `MOODLE_ICAL_URL`).

### O que preencher para correr o probe

No mínimo:

```dotenv
MOODLE_URL=https://moodle.da-tua-universidade.pt
MOODLE_USERNAME=o-teu-utilizador
MOODLE_PASSWORD=a-tua-password
```

Se já tiveres um token ou URL iCal, preenche também `MOODLE_TOKEN` ou
`MOODLE_ICAL_URL`; nesse caso a password pode ficar vazia.

## Dashboard

Depois de configurar o `.env`:

```bash
npm start
# abrir http://127.0.0.1:3000
```

A interface inclui:

- **Resumo do semestre** — prazos futuros, próximos 7 dias, atrasados e cadeiras.
- **Linha temporal** — eventos agrupados em Hoje, Amanhã, Esta semana e Mais tarde,
  com contagem decrescente, tipo e cadeira.
- **Vista de calendário** — mês completo com os prazos de cada dia; clicar num dia
  filtra a lista.
- **Filtros** — pesquisa por texto, tipo (teste, exame, entrega, outro), cadeira,
  estado de revisão e prazos passados.
- **Mini calendário e resumo por cadeira** na barra lateral.
- **Tema claro/escuro**, lembrado no `localStorage`.
- **Estado da ligação** — distingue dados obtidos agora, cache em memória, cache
  local e falha de atualização.
- **Ficheiros das cadeiras** — botão “Analisar ficheiros” que descarrega os PDF e
  PPTX das cadeiras em segundo plano, com barra de progresso, resumo e lista por
  cadeira. Cada ficheiro indica páginas, caracteres extraídos e eventuais avisos.
- **Revisão de datas extraídas** — cada data encontrada num ficheiro aparece com a
  etiqueta “Por rever”, o ficheiro/página de origem e um trecho de contexto. Os
  botões **Confirmar**, **Corrigir** e **Descartar** atualizam o dashboard de
  imediato; as descartadas podem ser recuperadas no filtro “Descartadas”.

O backend junta duas fontes oficiais do Moodle:

1. `core_calendar_get_calendar_events`, com todas as cadeiras no mesmo pedido,
   para o calendário completo.
2. `mod_assign_get_assignments`, também com todas as cadeiras, para enriquecer as
   entregas e recuperar tarefas sem evento de calendário.

Se o Moodle não aceitar vários `courseids` numa só chamada, o cliente volta ao
pedido por cadeira e mostra um aviso na interface.

Os eventos de abertura de atividades (`eventtype: open`) são ignorados: só
interessam prazos. Os duplicados entre calendário e tarefas são combinados pelo
título, cadeira e data. Eventos dos últimos 90 dias e todos os futuros são
mantidos; a interface esconde os passados por defeito.

### Ficheiros das cadeiras (Fase 2)

O botão **Analisar ficheiros** percorre as secções visíveis de cada cadeira com
`core_course_get_contents`, seleciona os ficheiros `.pdf` e `.pptx` e descarrega-os
de `webservice/pluginfile.php` para `data/files/`. A análise corre em segundo
plano: a página consulta `/api/files` a cada segundo enquanto o estado for
`a-analisar`.

- **Pedidos sequenciais** — um ficheiro de cada vez, com a pausa configurada em
  `MOODLE_DELAY_MS`; uma falha isolada marca apenas esse ficheiro como `erro`.
- **Cache de download** — um ficheiro com o mesmo URL, tamanho e data de
  modificação não é descarregado outra vez. `data/cache/ficheiros.json` guarda o
  inventário e `data/cache/texto/<hash>.json` guarda o texto extraído.
- **Limites** — `MAX_FILES_PER_COURSE`, `MAX_FILE_MB` e `MAX_TOTAL_MB`. Ficheiros
  vazios ou acima do limite ficam marcados como `ignorado`, com o motivo.
- **Formatos suportados** — PDF (texto, fontes simples e Type0 com `ToUnicode`) e
  PPTX (por slide). DOCX fica para uma fase posterior.
- **Privacidade** — a API não devolve URLs dos ficheiros nem o texto extraído; o
  token só é acrescentado ao URL no momento do pedido e nunca é guardado.

### Datas extraídas e revisão manual (Fase 3)

Depois de analisar os ficheiros, o servidor percorre o texto em cache e procura
datas com contexto de avaliação. Os eventos resultantes entram sempre como
`needs-review`; os eventos oficiais do Moodle continuam `confirmed`.

- **Formatos reconhecidos** — `18/12/2026`, `18-12-2026`, `18.12.2026`,
  `18 de dezembro de 2026`, `18 dez` e datas sem ano (o ano letivo é inferido).
  Também reconhece referências a `semana N`, convertidas com `SEMESTER_START`.
- **Contexto e tipo** — o parser guarda um `snippet` à volta da data e classifica
  o evento como teste, exame, entrega ou outro, dando prioridade ao título.
- **Filtro de ruído** — datas sem palavras de avaliação próximas são ignoradas,
  tal como rodapés, datas de criação de documentos e referências legais. Datas
  fora da janela letiva (45 dias antes de `SEMESTER_START` até 400 dias depois)
  são descartadas.
- **Deduplicação** — a mesma data e título repetidos em várias páginas do mesmo
  ficheiro contam uma só vez; a primeira ocorrência é a que fica.
- **Decisões persistentes** — `data/overrides.json` guarda as ações manuais. Uma
  data confirmada ou corrigida passa a contar como ativa; uma data descartada
  continua na lista com `status: "dismissed"` para poder ser recuperada. O
  ficheiro é escrito de forma atómica e nunca contém credenciais.

A revisão é feita na própria interface: o cartão **Revisão** mostra o total de
datas extraídas, quantas estão por rever, confirmadas e descartadas. O botão
**Corrigir** abre um formulário com data/hora e título; a data original da
sugestão fica visível para comparação.

### API local

| Rota | Descrição |
| --- | --- |
| `GET /api/setup` | Estado da configuração: se está pendente, se existe `.env`, ano letivo sugerido e URL base. |
| `POST /api/setup` | Valida as credenciais, obtém um token, cria o `.env` e aplica a configuração. Só disponível enquanto pendente. |
| `GET /api/events` | Devolve site, cadeiras e eventos normalizados (oficiais e extraídos, com as decisões de revisão aplicadas). Usa cache quando válido. |
| `POST /api/refresh` | Força uma nova recolha ao Moodle. |
| `GET /api/files` | Inventário da análise de ficheiros e progresso atual. |
| `POST /api/files/scan` | Inicia a análise em segundo plano; responde `202` de imediato. |
| `POST /api/review` | Confirma (`confirm`), corrige (`correct`, com `date`/`title`) ou descarta (`dismiss`) um evento `ficheiro-*`. |
| `GET /api/health` | Estado do servidor, última atualização, análise de ficheiros, resumo de revisão e `configuracaoPendente`. |

Enquanto a configuração estiver pendente, as rotas de dados respondem `428` com
`configuracaoPendente: true`. O `POST /api/setup` responde `409` se a
configuração já estiver completa e `401`/`502` se as credenciais ou a ligação
falharem; a mensagem de erro nunca inclui a palavra-passe.

Se o Moodle falhar mas existir um snapshot local, a API responde na mesma com
`meta.aviso` e `meta.origem: "cache"`; a UI mostra o aviso e permite tentar
novamente. O cache fica em `data/cache/dashboard.json` e nunca contém tokens,
passwords ou cookies.

## Segurança

- Credenciais e tokens ficam apenas no `.env` (ignorado pelo Git).
- O assistente guarda apenas o token; a palavra-passe existe só em memória
  durante o pedido de configuração.
- Em sistemas Unix, o `.env` é criado com permissões `600`.
- A password não é escrita em `data/`, relatórios ou logs.
- Tokens, cookies e URLs iCal com `authtoken` não são impressos pelo probe.
- O `GET /api/setup` nunca devolve credenciais nem o conteúdo do `.env`.
- O servidor escuta apenas em `127.0.0.1`.
- Pedidos ao Moodle são sequenciais, com pausa e timeout.
- Os dados recolhidos ficam em `data/`, também ignorada pelo Git.

## Estrutura

```
server/
  index.js                 # servidor HTTP, rotas da API e ficheiros estáticos
  config.js                # leitura e validação do .env
  setup.js                 # assistente: validação, URL, token e escrita do .env
  moodle/
    client.js              # cliente da Web Service (token em memória, pedidos sequenciais)
  sources/
    calendar.js            # calendário + tarefas normalizados e combinados
    files.js               # ficheiros por cadeira, download com cache e análise
    extracted.js           # eventos a partir do texto, janela letiva e deduplicação
  extractors/
    zip.js                 # leitor ZIP mínimo (node:zlib)
    texto.js               # entidades XML e normalização de texto
    pptx.js                # texto de cada slide
    pdf.js                 # texto de PDF página a página, sem dependências
  parsers/
    dates.js               # datas, contexto, títulos e classificação de tipos
    semesterWeeks.js       # conversão de "semana N" e fusos horários
  store.js                 # cache do dashboard e decisões de revisão (data/)
public/
  index.html               # dashboard
  style.css                # tema escuro/claro e responsivo
  app.js                   # filtros, linha temporal, calendários e revisão
scripts/probe.js           # diagnóstico do Moodle
test/                      # testes com node --test
```

## Comandos

```bash
npm start        # servidor local em http://localhost:3000
npm run dev      # servidor com --watch
npm run probe    # diagnóstico do Moodle
npm test         # testes com node --test
```

### Limpar os dados locais

`npm run limpar` remove tudo o que o Git ignora, para voltar a um estado limpo:
`.env`, `data/` (cache, ficheiros e decisões de revisão), `logs/`, `tmp/`,
`coverage/`, `node_modules/` e ficheiros como `*.log` ou `.env.local`. O
`.env.example` e todo o código-fonte são preservados.

```bash
npm run limpar -- --sim     # mostra o que seria removido, sem apagar
npm run limpar              # remove de facto
```

Para o servidor antes de executar o comando. Sem `.env`, o próximo `npm start`
volta a abrir o assistente de primeira configuração.

## Dependências

- **Fase 0/1/2/3/4:** nenhuma dependência externa. O servidor usa `node:http`,
  `fetch`, `node:fs`, `node:path`, `node:zlib`, `node:crypto` e `node:util`; o
  frontend é HTML, CSS e JavaScript vanilla. Os extractores de ZIP, PPTX e PDF e
  o parser de datas foram implementados com a biblioteca padrão para evitar
  pacotes e manter a aplicação portátil.
- Fases seguintes: cada nova dependência será justificada nesta secção.

## Limitações conhecidas

- As datas dentro de PPTX/PDF são sugestões heurísticas: entram sempre como
  **por rever** e não substituem o calendário oficial. Datas sem ano são
  inferidas e podem estar erradas, sobretudo perto da mudança de ano letivo.
- O extractor de PDF cobre os casos comuns (Word, PowerPoint, LaTeX, LibreOffice),
  mas é heurístico: tabelas podem produzir linhas fragmentadas e dígitos
  separados, e PDFs digitalizados (imagem) não têm texto extraível. O parser
  normaliza espaços e tolera esses fragmentos, mas a revisão manual continua a ser
  necessária.
- Tabelas de planificação com várias datas por linha podem gerar sugestões
  duplicadas ou pouco claras (por exemplo, “Testes unitários” na semana 1). O
  utilizador pode corrigi-las ou descartá-las.
- As decisões de revisão são guardadas por identificador estável do evento. Se o
  texto de um ficheiro mudar substancialmente numa nova análise, pode surgir uma
  nova sugestão que precisa de ser revista outra vez.
- PDFs protegidos por palavra-passe não são abertos; ficam marcados como erro,
  sem tentativa de adivinhar a password.
- Apenas `.pdf` e `.pptx` são descarregados nesta fase. Outros formatos (incluindo
  DOCX, XLSX e ZIP) são ignorados silenciosamente.
- A primeira análise descarrega todos os ficheiros e pode demorar alguns minutos;
  as seguintes reutilizam o cache de downloads e de texto.
- A classificação do tipo de evento é heurística e baseada no módulo do Moodle e
  em palavras-chave do título/descrição.
- Eventos do Moodle com mais de 90 dias não são guardados no snapshot; os futuros
  aparecem sempre. A UI esconde os passados por defeito.
- A primeira recolha ao Moodle pode demorar alguns segundos porque os pedidos são
  sequenciais. Depois disso, o cache local responde de imediato.
- Algumas universidades desativam web services mobile ou usam SSO/Shibboleth
  incompatível com login por formulário. O probe deteta e reporta esses casos.
- O assistente assume o URL `<base>/<ano letivo>/`. Instituições com outro formato
  têm de configurar `MOODLE_URL` manualmente no `.env`.
- Não há interface de reconfiguração: para voltar a pedir as credenciais, remove o
  `.env` e reinicia o servidor.

## Plano por fases

1. **Fase 0:** estrutura, regras, diagnóstico do Moodle. ✅
2. **Fase 1:** ligação ao Moodle, calendário + tarefas, `/api/events` e dashboard
   visual. ✅
3. **Fase 2:** download/cache de ficheiros e extractores PPTX/PDF. ✅
4. **Fase 3:** parser de datas, semanas e revisão manual. ✅
5. **Fase 4:** assistente de primeira configuração, polimento e README. ✅ atual
6. **Fase 5 (opcional):** extração com LLM.
