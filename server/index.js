import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {
  RAIZ_PROJETO,
  carregarEnv,
  obterConfigMoodle,
  obterConfigServidor,
} from './config.js';
import { criarClienteMoodle } from './moodle/client.js';
import { recolherDadosDashboard } from './sources/calendar.js';
import {
  limparCacheEventosExtraidos,
  obterEventosExtraidos,
} from './sources/extracted.js';
import {
  analisarFicheiros,
  lerInventarioFicheiros,
} from './sources/files.js';
import {
  configuracaoPendente,
  construirUrlMoodle,
  guardarConfiguracaoInicial,
  limparSnapshotDashboard,
  obterEstadoConfiguracao,
  validarConfiguracaoInicial,
} from './setup.js';
import {
  ACOES_REVISAO,
  aplicarOverrides,
  cacheValido,
  guardarCache,
  guardarOverrides,
  lerCache,
  lerOverrides,
} from './store.js';

carregarEnv();

const { anfitriao, porta } = obterConfigServidor();
const PASTA_PUBLICA = path.join(RAIZ_PROJETO, 'public');

const TIPOS_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const CABECALHOS_SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
};

let dadosEmMemoria = null;
let atualizacaoEmCurso = null;
let ultimoErro = null;
let configuracaoEmCurso = false;

const ESTADO_FICHEIROS_VAZIO = {
  estado: 'nunca',
  iniciadoEm: null,
  terminadoEm: null,
  erro: null,
  avisos: [],
  progresso: {
    cursos: 0,
    totalCursos: 0,
    ficheiros: 0,
    totalFicheiros: 0,
    extraidos: 0,
    ignorados: 0,
    erros: 0,
  },
  resumo: {
    ficheiros: 0,
    extraidos: 0,
    semTexto: 0,
    ignorados: 0,
    erros: 0,
    caracteres: 0,
    bytesDescarregados: 0,
  },
  ficheiros: [],
};

let estadoFicheiros = { ...ESTADO_FICHEIROS_VAZIO };
let analiseFicheirosEmCurso = null;

function responderJson(resposta, estado, dados) {
  resposta.writeHead(estado, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  resposta.end(JSON.stringify(dados));
}

function mensagemErro(erro) {
  return erro?.message || 'Erro inesperado no servidor.';
}

/**
 * Responde 428 enquanto não houver uma forma válida de autenticação. A página
 * mostra o assistente de configuração antes de pedir estes dados.
 */
function configuracaoEmFalta(resposta) {
  if (!configuracaoPendente()) {
    return false;
  }

  responderJson(resposta, 428, {
    erro: 'Falta configurar a ligação ao Moodle.',
    configuracaoPendente: true,
  });
  return true;
}

function comMeta(dados, meta) {
  return {
    ...dados,
    meta: {
      ...meta,
      totalEventos: dados.eventos.length,
      porRever: dados.revisao?.porRever ?? 0,
      geradoEm: dados.geradoEm,
    },
  };
}

/**
 * Junta o snapshot oficial do Moodle com as datas extraídas dos ficheiros e
 * aplica as decisões manuais. Os eventos descartados continuam na lista (com
 * `status: "dismissed"`) para que a decisão possa ser revertida na UI.
 */
async function montarDashboard(base) {
  const [extraidos, overrides] = await Promise.all([
    obterEventosExtraidos(),
    lerOverrides(),
  ]);
  const eventos = [...(base.eventos || []), ...extraidos.eventos];
  const resultado = aplicarOverrides(eventos, overrides);
  const totaisPorCurso = new Map();

  for (const evento of resultado.eventos) {
    if (evento.status !== 'dismissed' && evento.courseId) {
      totaisPorCurso.set(
        evento.courseId,
        (totaisPorCurso.get(evento.courseId) || 0) + 1,
      );
    }
  }

  return {
    ...base,
    cursos: (base.cursos || []).map((curso) => ({
      ...curso,
      total: totaisPorCurso.get(Number(curso.id)) || 0,
    })),
    eventos: resultado.eventos,
    revisao: {
      ...resultado.resumo,
      extraidas: extraidos.resumo.eventos,
      ficheiros: extraidos.resumo.ficheirosAnalisados,
      paginas: extraidos.resumo.paginasAnalisadas,
      porConfianca: extraidos.resumo.porConfianca,
    },
  };
}

/**
 * Lê um corpo JSON pequeno. A API local não recebe ficheiros nem HTML, por isso
 * o limite pode ser baixo.
 */
async function lerCorpoJson(pedido, limite = 16 * 1024) {
  const partes = [];
  let tamanho = 0;

  for await (const parte of pedido) {
    tamanho += parte.length;

    if (tamanho > limite) {
      const erro = new Error('O pedido é demasiado grande.');
      erro.status = 413;
      throw erro;
    }

    partes.push(parte);
  }

  if (tamanho === 0) {
    const erro = new Error('O pedido tem de incluir um corpo JSON.');
    erro.status = 400;
    throw erro;
  }

  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    const erro = new Error('O corpo do pedido não é JSON válido.');
    erro.status = 400;
    throw erro;
  }
}

async function atualizarDoMoodle() {
  const config = obterConfigMoodle();
  const cliente = criarClienteMoodle(config);
  const dados = await recolherDadosDashboard(cliente);

  dadosEmMemoria = dados;
  ultimoErro = null;

  try {
    await guardarCache(dados);
  } catch (erro) {
    console.warn(`Não foi possível guardar o cache local: ${erro.message}`);
  }

  return dados;
}

/**
 * Corre a análise de ficheiros em segundo plano. A lista de cadeiras vem do
 * snapshot do dashboard para não repetir pedidos desnecessários ao Moodle.
 */
async function executarAnaliseFicheiros(forcar) {
  const dados = await obterDados();
  const cursos = (dados.cursos || []).map((curso) => ({
    id: curso.id,
    fullname: curso.nome,
    shortname: curso.curto,
  }));
  const cliente = criarClienteMoodle(obterConfigMoodle());

  return analisarFicheiros(cliente, cursos, {
    forcar,
    aoAtualizar: (parcial) => {
      estadoFicheiros = parcial;
    },
  });
}

function iniciarAnaliseFicheiros(forcar = false) {
  if (analiseFicheirosEmCurso) {
    return;
  }

  estadoFicheiros = {
    ...ESTADO_FICHEIROS_VAZIO,
    estado: 'a-analisar',
    iniciadoEm: new Date().toISOString(),
    ficheiros: [],
  };

  analiseFicheirosEmCurso = executarAnaliseFicheiros(forcar)
    .then((resultado) => {
      estadoFicheiros = resultado;
      limparCacheEventosExtraidos();
    })
    .catch((erro) => {
      estadoFicheiros = {
        ...estadoFicheiros,
        estado: 'erro',
        erro: mensagemErro(erro),
        terminadoEm: new Date().toISOString(),
      };
    })
    .finally(() => {
      analiseFicheirosEmCurso = null;
    });
}

/**
 * Devolve os dados mais frescos possíveis. Se o Moodle falhar, usa o último
 * snapshot (memória ou disco) e assinala-o no campo `meta.aviso`.
 */
async function obterDados({ forcar = false } = {}) {
  if (!forcar) {
    if (dadosEmMemoria && cacheValido(dadosEmMemoria)) {
      return comMeta(await montarDashboard(dadosEmMemoria), {
        origem: 'memoria',
        emCache: true,
        aviso: null,
      });
    }

    if (!dadosEmMemoria) {
      const cache = await lerCache();

      if (cache && cacheValido(cache)) {
        dadosEmMemoria = cache;
        return comMeta(await montarDashboard(cache), {
          origem: 'disco',
          emCache: true,
          aviso: null,
        });
      }
    }
  }

  if (!atualizacaoEmCurso) {
    atualizacaoEmCurso = atualizarDoMoodle().finally(() => {
      atualizacaoEmCurso = null;
    });
  }

  try {
    const dados = await atualizacaoEmCurso;
    return comMeta(await montarDashboard(dados), {
      origem: 'moodle',
      emCache: false,
      aviso: null,
    });
  } catch (erro) {
    ultimoErro = erro;
    const alternativa = dadosEmMemoria || (await lerCache());

    if (alternativa) {
      dadosEmMemoria = alternativa;
      return comMeta(await montarDashboard(alternativa), {
        origem: 'cache',
        emCache: true,
        aviso:
          `Não foi possível atualizar a partir do Moodle. A mostrar os últimos dados guardados. ` +
          `(${mensagemErro(erro)})`,
      });
    }

    throw erro;
  }
}

async function servirEstatico(resposta, caminhoPedido) {
  let relativo;

  try {
    relativo = decodeURIComponent(caminhoPedido);
  } catch {
    resposta.writeHead(400, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/plain; charset=utf-8' });
    resposta.end('Caminho inválido.');
    return;
  }

  if (relativo === '/' || relativo === '') {
    relativo = '/index.html';
  }

  const ficheiro = path.normalize(path.join(PASTA_PUBLICA, relativo));
  const prefixo = PASTA_PUBLICA + path.sep;

  if (ficheiro !== PASTA_PUBLICA && !ficheiro.startsWith(prefixo)) {
    resposta.writeHead(404, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/plain; charset=utf-8' });
    resposta.end('Não encontrado.');
    return;
  }

  try {
    const conteudo = await readFile(ficheiro);
    const tipo = TIPOS_MIME[path.extname(ficheiro).toLowerCase()] || 'application/octet-stream';

    resposta.writeHead(200, {
      ...CABECALHOS_SEGURANCA,
      'Content-Type': tipo,
      'Cache-Control': 'no-cache',
    });
    resposta.end(conteudo);
  } catch (erro) {
    const estado = erro.code === 'ENOENT' || erro.code === 'EISDIR' ? 404 : 500;
    resposta.writeHead(estado, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/plain; charset=utf-8' });
    resposta.end(estado === 404 ? 'Não encontrado.' : 'Não foi possível ler o ficheiro.');
  }
}

const servidor = http.createServer(async (pedido, resposta) => {
  const url = new URL(pedido.url, `http://${anfitriao}:${porta}`);
  const rota = url.pathname;

  if (pedido.method === 'GET' && rota === '/api/setup') {
    try {
      responderJson(resposta, 200, await obterEstadoConfiguracao());
    } catch (erro) {
      responderJson(resposta, 500, { erro: mensagemErro(erro) });
    }
    return;
  }

  if (pedido.method === 'POST' && rota === '/api/setup') {
    if (configuracaoEmCurso) {
      responderJson(resposta, 409, {
        erro: 'Já existe uma configuração em curso. Aguarda alguns segundos.',
      });
      return;
    }

    if (!configuracaoPendente()) {
      responderJson(resposta, 409, {
        erro:
          'A ligação ao Moodle já está configurada. Para voltar a configurar, ' +
          'remove o ficheiro .env e reinicia o servidor.',
      });
      return;
    }

    configuracaoEmCurso = true;

    try {
      const corpo = await lerCorpoJson(pedido);
      let dados;

      try {
        dados = validarConfiguracaoInicial(corpo);
      } catch (erro) {
        erro.status = 400;
        throw erro;
      }

      const urlMoodle = construirUrlMoodle(dados.anoLetivo);
      const cliente = criarClienteMoodle({
        urlBase: urlMoodle,
        username: dados.numeroAluno,
        password: dados.password,
        token: '',
        service: process.env.MOODLE_SERVICE || 'moodle_mobile_app',
      });

      // A password só existe em memória durante este pedido. Depois de validar
      // as credenciais, guarda-se apenas o token devolvido pelo Moodle.
      const site = await cliente.obterSiteInfo();
      const token = await cliente.obterToken();

      await guardarConfiguracaoInicial({
        urlMoodle,
        numeroAluno: dados.numeroAluno,
        token,
        semestreInicio: dados.semestreInicio,
      });
      await limparSnapshotDashboard();

      dadosEmMemoria = null;
      ultimoErro = null;

      responderJson(resposta, 200, {
        ok: true,
        pendente: false,
        site: typeof site?.sitename === 'string' ? site.sitename : null,
        utilizador: typeof site?.fullname === 'string' ? site.fullname : null,
        url: urlMoodle,
      });
    } catch (erro) {
      responderJson(resposta, erro.status || (erro.autenticacao ? 401 : 502), {
        erro: mensagemErro(erro),
        detalhe: erro.autenticacao
          ? 'Confirma o número de aluno e a palavra-passe. A palavra-passe não foi guardada.'
          : 'Não foi possível concluir a configuração.',
      });
    } finally {
      configuracaoEmCurso = false;
    }
    return;
  }

  if (pedido.method === 'GET' && rota === '/api/events') {
    if (configuracaoEmFalta(resposta)) {
      return;
    }

    try {
      const forcar = url.searchParams.get('forcar') === '1';
      responderJson(resposta, 200, await obterDados({ forcar }));
    } catch (erro) {
      responderJson(resposta, 502, {
        erro: mensagemErro(erro),
        detalhe:
          'Confirma MOODLE_URL, as credenciais ou o token no .env e a ligação à Internet.',
      });
    }
    return;
  }

  if (pedido.method === 'POST' && rota === '/api/refresh') {
    if (configuracaoEmFalta(resposta)) {
      return;
    }

    try {
      responderJson(resposta, 200, await obterDados({ forcar: true }));
    } catch (erro) {
      responderJson(resposta, 502, {
        erro: mensagemErro(erro),
        detalhe: 'Não foi possível atualizar os dados do Moodle.',
      });
    }
    return;
  }

  if (pedido.method === 'POST' && rota === '/api/review') {
    if (configuracaoEmFalta(resposta)) {
      return;
    }

    try {
      const corpo = await lerCorpoJson(pedido);
      const id = typeof corpo.id === 'string' ? corpo.id.trim() : '';
      const acao = String(corpo.action || '');

      if (!id.startsWith('ficheiro-') || id.length > 120) {
        const erro = new Error('Só é possível rever eventos extraídos de ficheiros.');
        erro.status = 400;
        throw erro;
      }

      if (!ACOES_REVISAO.has(acao)) {
        const erro = new Error('A ação tem de ser confirm, correct ou dismiss.');
        erro.status = 400;
        throw erro;
      }

      const override = {
        action: acao,
        atualizadoEm: new Date().toISOString(),
      };

      if (acao === 'correct') {
        const data = new Date(corpo.date);

        if (!corpo.date || Number.isNaN(data.getTime())) {
          const erro = new Error('Indica uma data e hora válidas para corrigir o evento.');
          erro.status = 400;
          throw erro;
        }

        override.date = data.toISOString();

        if (typeof corpo.title === 'string' && corpo.title.trim()) {
          override.title = corpo.title.trim().slice(0, 160);
        }
      }

      const overrides = await lerOverrides();
      overrides[id] = override;
      await guardarOverrides(overrides);

      responderJson(resposta, 200, await obterDados());
    } catch (erro) {
      responderJson(resposta, erro.status || 500, {
        erro: mensagemErro(erro),
      });
    }
    return;
  }

  if (pedido.method === 'GET' && rota === '/api/files') {
    if (configuracaoEmFalta(resposta)) {
      return;
    }

    responderJson(resposta, 200, estadoFicheiros);
    return;
  }

  if (pedido.method === 'POST' && rota === '/api/files/scan') {
    if (configuracaoEmFalta(resposta)) {
      return;
    }

    const forcar = url.searchParams.get('forcar') === '1';
    iniciarAnaliseFicheiros(forcar);
    responderJson(resposta, 202, estadoFicheiros);
    return;
  }

  if (pedido.method === 'GET' && rota === '/api/health') {
    let revisao = null;

    try {
      const extraidos = await obterEventosExtraidos();
      revisao = aplicarOverrides(extraidos.eventos, await lerOverrides()).resumo;
    } catch {
      revisao = null;
    }

    responderJson(resposta, 200, {
      ok: true,
      configuracaoPendente: configuracaoPendente(),
      ultimaAtualizacao: dadosEmMemoria?.geradoEm || null,
      eventos: dadosEmMemoria?.eventos?.length ?? null,
      erro: ultimoErro ? mensagemErro(ultimoErro) : null,
      revisao,
      ficheiros: {
        estado: estadoFicheiros.estado,
        total: estadoFicheiros.ficheiros.length,
        extraidos: estadoFicheiros.resumo.extraidos,
      },
    });
    return;
  }

  if ((pedido.method === 'GET' || pedido.method === 'HEAD') && !rota.startsWith('/api/')) {
    await servirEstatico(resposta, rota);
    return;
  }

  responderJson(resposta, 404, { erro: 'Rota não encontrada.' });
});

lerInventarioFicheiros()
  .then((dados) => {
    if (dados?.ficheiros) {
      estadoFicheiros = dados;
    }
  })
  .catch((erro) => {
    console.warn(`Não foi possível ler o inventário de ficheiros: ${erro.message}`);
  });

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(
      `A porta ${porta} já está ocupada. Altera PORT no .env ou fecha a outra aplicação.`,
    );
  } else {
    console.error(`Erro no servidor: ${erro.message}`);
  }
  process.exitCode = 1;
});

servidor.listen(porta, anfitriao, () => {
  console.log(`Dashboard em http://${anfitriao}:${porta} (apenas local)`);

  if (configuracaoPendente()) {
    console.log(
      'Configuração pendente: abre a página para indicar o ano letivo, o número de aluno e a palavra-passe.',
    );
    return;
  }

  // Aquece o dashboard em segundo plano para a primeira página abrir depressa.
  obterDados()
    .then((dados) => {
      console.log(
        `Dados prontos: ${dados.eventos.length} evento(s), ${dados.cursos.length} cadeira(s) (${dados.meta.origem}).`,
      );
    })
    .catch((erro) => {
      console.warn(`Ainda sem dados do Moodle: ${mensagemErro(erro)}`);
    });
});
