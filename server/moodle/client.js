import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lerNumeroEnv, urlDoMoodle } from '../config.js';

const TIMEOUT_MS = 20_000;
const USER_AGENT = 'MoodleDeadlinesDashboard/0.3 (dashboard local)';

const MENSAGENS_ERRO_TOKEN = {
  invalidlogin: 'utilizador ou palavra-passe inválidos',
  invalidpassword: 'palavra-passe inválida',
  usernotfound: 'utilizador não encontrado',
  enablewsdescription: 'os web services mobile não estão ativados neste Moodle',
  servicenotavailable: 'o serviço mobile não está disponível',
  invalidservice: 'o serviço indicado em MOODLE_SERVICE é inválido',
  accessexception: 'o acesso ao serviço foi recusado',
};

const MENSAGENS_ERRO_REDE = {
  ENOTFOUND: 'servidor não encontrado (verifica MOODLE_URL e a ligação à Internet)',
  ECONNREFUSED: 'ligação recusada pelo servidor',
  ECONNRESET: 'ligação interrompida pelo servidor',
  CERT_HAS_EXPIRED: 'certificado TLS expirado',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificado TLS autoassinado',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificado TLS não verificável',
};

export class ErroMoodle extends Error {
  constructor(mensagem, { codigo = null, autenticacao = false, causa = null } = {}) {
    super(mensagem, { cause: causa });
    this.name = 'ErroMoodle';
    this.codigo = codigo;
    this.autenticacao = autenticacao;
  }
}

function descreverErroRede(erro) {
  if (erro.name === 'TimeoutError' || erro.name === 'AbortError') {
    return `o Moodle não respondeu em ${TIMEOUT_MS / 1000} segundos`;
  }

  return MENSAGENS_ERRO_REDE[erro.cause?.code] || erro.message || String(erro);
}

/**
 * Cliente mínimo da Web Service do Moodle.
 *
 * - Faz pedidos sequenciais, com uma pausa configurável (`MOODLE_DELAY_MS`).
 * - O token é mantido apenas em memória e nunca é escrito em logs ou respostas.
 * - Se `MOODLE_TOKEN` estiver vazio, obtém um token com as credenciais do .env.
 */
export function criarClienteMoodle(config) {
  let token = config.token || null;
  let pedidosEfetuados = 0;

  async function pedido(url, opcoes = {}) {
    const pausaMs = lerNumeroEnv('MOODLE_DELAY_MS', 800, 0);

    if (pedidosEfetuados > 0 && pausaMs > 0) {
      await new Promise((resolver) => setTimeout(resolver, pausaMs));
    }
    pedidosEfetuados += 1;

    try {
      return await fetch(url, {
        ...opcoes,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'User-Agent': USER_AGENT,
          ...(opcoes.headers || {}),
        },
      });
    } catch (erro) {
      throw new ErroMoodle(descreverErroRede(erro), { causa: erro });
    }
  }

  async function autenticar() {
    if (token) {
      return token;
    }

    if (!config.username || !config.password) {
      throw new ErroMoodle(
        'Não há forma de autenticar no Moodle. Define MOODLE_TOKEN ou MOODLE_USERNAME e MOODLE_PASSWORD no .env.',
        { autenticacao: true },
      );
    }

    const corpo = new URLSearchParams({
      username: config.username,
      password: config.password,
      service: config.service,
    });

    const resposta = await pedido(urlDoMoodle(config.urlBase, 'login/token.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
    });

    const texto = await resposta.text();

    if (resposta.status >= 300 && resposta.status < 400) {
      throw new ErroMoodle(
        `O login do Moodle redirecionou (HTTP ${resposta.status}). A instituição pode usar SSO/Shibboleth; nesse caso configura MOODLE_TOKEN ou MOODLE_ICAL_URL.`,
        { autenticacao: true },
      );
    }

    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new ErroMoodle(
        `Resposta inválida do login do Moodle (HTTP ${resposta.status}). Confirma MOODLE_URL e se o serviço REST está ativo.`,
        { autenticacao: true },
      );
    }

    if (dados?.error) {
      const codigo = dados.errorcode || 'sem-codigo';
      const motivo = MENSAGENS_ERRO_TOKEN[codigo] || dados.error || 'motivo não indicado';
      throw new ErroMoodle(`O Moodle recusou o login (${codigo}): ${motivo}.`, {
        codigo,
        autenticacao: true,
      });
    }

    if (!dados?.token) {
      throw new ErroMoodle('O login do Moodle respondeu sem token.', {
        autenticacao: true,
      });
    }

    token = dados.token;
    return token;
  }

  async function chamar(funcao, parametros = {}) {
    const tokenAtual = await autenticar();
    const corpo = new URLSearchParams({
      wstoken: tokenAtual,
      wsfunction: funcao,
      moodlewsrestformat: 'json',
      ...parametros,
    });

    const resposta = await pedido(
      urlDoMoodle(config.urlBase, 'webservice/rest/server.php'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo,
      },
    );

    const texto = await resposta.text();

    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new ErroMoodle(
        `Resposta não-JSON em ${funcao} (HTTP ${resposta.status}). Verifica MOODLE_URL e o serviço REST.`,
      );
    }

    if (dados?.exception) {
      const autenticacao = /invalidtoken|accessexception|invalidlogin/i.test(
        `${dados.errorcode || ''} ${dados.exception || ''}`,
      );
      throw new ErroMoodle(dados.message || dados.exception, {
        codigo: dados.errorcode,
        autenticacao,
      });
    }

    if (!resposta.ok) {
      throw new ErroMoodle(`O Moodle devolveu HTTP ${resposta.status} em ${funcao}.`);
    }

    return dados;
  }

  return {
    urlBase: config.urlBase,

    /**
     * Devolve o token já obtido (ou autentica se necessário). É usado apenas
     * pelo assistente de configuração para guardar o token em vez da password.
     */
    async obterToken() {
      return autenticar();
    },

    async obterSiteInfo() {
      return chamar('core_webservice_get_site_info');
    },

    async listarCursos(userId) {
      const cursos = await chamar('core_enrol_get_users_courses', {
        userid: userId,
      });
      return Array.isArray(cursos) ? cursos : [];
    },

    /**
     * Devolve os eventos de várias cadeiras numa única chamada. Pedir tudo de
     * uma vez (em vez de uma chamada por cadeira) reduz o número de pedidos ao
     * Moodle, que é o recurso mais sensível. A resposta traz `courseid`, mas não
     * o nome da cadeira; o chamador resolve-o com a lista de cursos.
     */
    async listarEventosDasCadeiras(cursoIds = []) {
      if (cursoIds.length === 0) {
        return [];
      }

      const parametros = {};
      cursoIds.forEach((cursoId, indice) => {
        parametros[`events[courseids][${indice}]`] = String(cursoId);
      });

      const dados = await chamar('core_calendar_get_calendar_events', parametros);
      return Array.isArray(dados?.events) ? dados.events : [];
    },

    /**
     * Devolve os eventos de um único curso. Usado como alternativa quando o
     * Moodle não aceita vários `courseids` no mesmo pedido.
     */
    async listarEventosDoCurso(cursoId) {
      const dados = await chamar('core_calendar_get_calendar_events', {
        'events[courseids][0]': String(cursoId),
      });
      return Array.isArray(dados?.events) ? dados.events : [];
    },

    async obterTarefas(cursoIds = []) {
      const parametros = {};
      cursoIds.forEach((cursoId, indice) => {
        parametros[`courseids[${indice}]`] = String(cursoId);
      });

      const dados = await chamar('mod_assign_get_assignments', parametros);
      return Array.isArray(dados?.courses) ? dados.courses : [];
    },

    /**
     * Lista as secções e módulos de uma cadeira. Não existe equivalente
     * multi-curso nesta função do Moodle, por isso os pedidos são sequenciais.
     */
    async listarConteudosDoCurso(cursoId) {
      const dados = await chamar('core_course_get_contents', {
        courseid: String(cursoId),
      });
      return Array.isArray(dados) ? dados : [];
    },

    /**
     * Descarrega um ficheiro de `webservice/pluginfile.php` para o caminho
     * indicado. O token só é acrescentado ao URL no momento do pedido e nunca é
     * guardado em disco, em cache ou em mensagens de erro.
     */
    async descarregarFicheiro(fileurl, destino) {
      let alvo;

      try {
        alvo = new URL(fileurl);
      } catch {
        throw new ErroMoodle('URL de ficheiro inválido.');
      }

      const prefixo = new URL(
        urlDoMoodle(config.urlBase, 'webservice/pluginfile.php'),
      );

      if (
        alvo.origin !== prefixo.origin ||
        !alvo.pathname.startsWith(prefixo.pathname)
      ) {
        throw new ErroMoodle('O ficheiro não pertence ao Moodle configurado.');
      }

      const tokenAtual = await autenticar();
      alvo.searchParams.set('token', tokenAtual);

      const resposta = await pedido(alvo.href);
      const tamanhoMaximo = lerNumeroEnv('MAX_FILE_MB', 20, 0) * 1024 * 1024;
      const declarado = Number(resposta.headers.get('content-length'));

      if (Number.isFinite(declarado) && declarado > tamanhoMaximo) {
        throw new ErroMoodle('O ficheiro excede o limite de MAX_FILE_MB.');
      }

      if (!resposta.ok) {
        throw new ErroMoodle(
          `O Moodle devolveu HTTP ${resposta.status} ao descarregar um ficheiro.`,
        );
      }

      const conteudo = Buffer.from(await resposta.arrayBuffer());

      if (conteudo.length > tamanhoMaximo) {
        throw new ErroMoodle('O ficheiro excede o limite de MAX_FILE_MB.');
      }

      await mkdir(path.dirname(destino), { recursive: true });
      const temporario = `${destino}.tmp`;
      await writeFile(temporario, conteudo);
      await rename(temporario, destino);

      return { bytes: conteudo.length };
    },
  };
}
