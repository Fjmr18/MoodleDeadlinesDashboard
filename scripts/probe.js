#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  RAIZ_PROJETO,
  carregarEnv,
  lerNumeroEnv,
  obterConfigMoodle,
  urlDoMoodle,
} from '../server/config.js';

// ---------------------------------------------------------------------------
// Configuração local do probe
// ---------------------------------------------------------------------------

carregarEnv();

const PAUSA_MS = lerNumeroEnv('PROBE_DELAY_MS', 800, 0);
const TIMEOUT_MS = 20_000;
const USER_AGENT = 'MoodleDeadlinesDashboard/0.1 (probe local)';
const CAMINHO_RELATORIO = path.join(RAIZ_PROJETO, 'data', 'probe-report.json');

// Contador global para garantir pausa entre TODOS os pedidos ao Moodle, mesmo
// quando são feitos por funções diferentes.
let pedidosEfetuados = 0;

const FUNCOES_WEBSERVICE = [
  'core_webservice_get_site_info',
  'core_enrol_get_users_courses',
  'core_course_get_contents',
  'core_calendar_get_calendar_upcoming_view',
  'mod_assign_get_assignments',
];

const MENSAGENS_ERRO_TOKEN = {
  invalidlogin: 'credenciais inválidas',
  invalidpassword: 'palavra-passe inválida',
  usernotfound: 'utilizador não encontrado',
  enablewsdescription:
    'os web services mobile não estão ativados neste Moodle (administração)',
  servicenotavailable: 'o serviço mobile não está disponível',
  invalidservice: 'o serviço indicado em MOODLE_SERVICE é inválido',
  accessexception: 'o acesso ao serviço foi recusado',
};

// ---------------------------------------------------------------------------
// Utilitários de rede e erros
// ---------------------------------------------------------------------------

function dormir(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Pedido HTTP sequencial com timeout e pausa. Nunca imprime URL, corpo,
 * cookies ou cabeçalhos — alguns contêm tokens.
 */
async function pedido(url, opcoes = {}) {
  if (pedidosEfetuados > 0 && PAUSA_MS > 0) {
    await dormir(PAUSA_MS);
  }
  pedidosEfetuados += 1;

  return fetch(url, {
    redirect: 'manual',
    ...opcoes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent': USER_AGENT,
      ...(opcoes.headers || {}),
    },
  });
}

function descreverErro(erro) {
  if (!erro) {
    return 'erro desconhecido';
  }

  if (erro.name === 'TimeoutError' || erro.name === 'AbortError') {
    return `tempo limite de ${TIMEOUT_MS / 1000}s excedido`;
  }

  const codigoRede = erro.cause?.code;
  const mensagensRede = {
    ENOTFOUND: 'servidor não encontrado (verifica MOODLE_URL e a ligação à Internet)',
    ECONNREFUSED: 'ligação recusada pelo servidor',
    ECONNRESET: 'ligação interrompida pelo servidor',
    CERT_HAS_EXPIRED: 'certificado TLS expirado',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'certificado TLS autoassinado',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificado TLS não verificável',
  };

  if (mensagensRede[codigoRede]) {
    return mensagensRede[codigoRede];
  }

  if (erro.codigoMoodle) {
    return `Moodle devolveu "${erro.codigoMoodle}": ${erro.message}`;
  }

  return erro.message || String(erro);
}

function traduzirErroToken(dados) {
  const codigo = dados?.errorcode || 'sem-codigo';
  const motivo =
    MENSAGENS_ERRO_TOKEN[codigo] || dados?.error || 'motivo não indicado';
  return `login/token.php recusou (${codigo}): ${motivo}`;
}

// ---------------------------------------------------------------------------
// Cliente mínimo da Web Service do Moodle
// ---------------------------------------------------------------------------

async function chamarWebservice(config, token, funcao, parametros = {}) {
  const corpo = new URLSearchParams({
    wstoken: token,
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
    throw new Error(
      `resposta não-JSON em ${funcao} (HTTP ${resposta.status}); ` +
        'verifica MOODLE_URL e se o serviço REST está ativo',
    );
  }

  if (dados?.exception) {
    const erro = new Error(dados.message || dados.exception);
    erro.codigoMoodle = dados.errorcode;
    throw erro;
  }

  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status} em ${funcao}`);
  }

  return dados;
}

async function obterSiteInfo(config, token) {
  return chamarWebservice(config, token, 'core_webservice_get_site_info');
}

/**
 * Obtém um token utilizável: primeiro MOODLE_TOKEN; se falhar, tenta
 * /login/token.php com as credenciais. O token nunca é incluído no relatório.
 */
async function obterToken(config, relatorio) {
  const info = { source: null, ok: false, error: null };

  if (config.token) {
    try {
      const siteInfo = await obterSiteInfo(config, config.token);
      info.source = 'MOODLE_TOKEN (.env)';
      info.ok = true;
      info.error = null;
      return { token: config.token, siteInfo, info };
    } catch (erro) {
      info.error = `MOODLE_TOKEN rejeitado: ${descreverErro(erro)}`;
    }
  }

  if (!config.username || !config.password) {
    info.error =
      info.error ||
      'sem MOODLE_USERNAME/MOODLE_PASSWORD e sem MOODLE_TOKEN para autenticar';
    return { token: null, siteInfo: null, info };
  }

  try {
    const corpo = new URLSearchParams({
      username: config.username,
      password: config.password,
      service: config.service,
    });

    const resposta = await pedido(
      urlDoMoodle(config.urlBase, 'login/token.php'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo,
      },
    );

    const texto = await resposta.text();

    if (resposta.status >= 300 && resposta.status < 400) {
      throw new Error(
        `o endpoint redirecionou (HTTP ${resposta.status}); ` +
          'provavelmente o login é feito por SSO/Shibboleth',
      );
    }

    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error(
        `resposta não-JSON de login/token.php (HTTP ${resposta.status}); ` +
          'o Moodle pode ter um portal de autenticação à frente',
      );
    }

    if (dados?.error) {
      throw new Error(traduzirErroToken(dados));
    }

    if (!dados?.token) {
      throw new Error('login/token.php respondeu sem token');
    }

    const siteInfo = await obterSiteInfo(config, dados.token);
    info.source = 'login/token.php';
    info.ok = true;
    info.error = null;
    return { token: dados.token, siteInfo, info };
  } catch (erro) {
    info.error = descreverErro(erro);
    return { token: null, siteInfo: null, info };
  }
}

// ---------------------------------------------------------------------------
// Testes às funções da Web Service
// ---------------------------------------------------------------------------

function timestampParaIso(timestamp) {
  const numero = Number(timestamp);
  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }
  return new Date(numero * 1000).toISOString();
}

function extrairNomesFuncoes(siteInfo) {
  const funcoes = Array.isArray(siteInfo?.functions) ? siteInfo.functions : [];
  return new Set(funcoes.map((funcao) => funcao.name).filter(Boolean));
}

async function executarSeDisponivel(funcoes, nome, executar) {
  if (!funcoes.has(nome)) {
    return { ok: false, error: 'não disponível no serviço web configurado' };
  }

  try {
    return { ok: true, dados: await executar() };
  } catch (erro) {
    return { ok: false, error: descreverErro(erro) };
  }
}

async function testarFuncoesWebservice(config, token, siteInfo) {
  const funcoes = extrairNomesFuncoes(siteInfo);
  const resultado = {
    siteInfo: {
      ok: true,
      siteName: siteInfo.sitename || null,
      release: siteInfo.release || null,
      userId: siteInfo.userid || null,
      functionCount: funcoes.size,
    },
    courses: { ok: false, count: 0, sample: [], error: null },
    contents: { ok: false, sections: 0, modules: 0, fileModules: 0, error: null },
    calendar: { ok: false, count: 0, sample: [], error: null },
    assignments: { ok: false, count: 0, sample: [], error: null },
  };

  const calendario = await executarSeDisponivel(
    funcoes,
    'core_calendar_get_calendar_upcoming_view',
    () =>
      chamarWebservice(
        config,
        token,
        'core_calendar_get_calendar_upcoming_view',
      ),
  );

  if (calendario.ok) {
    const eventos = Array.isArray(calendario.dados?.events)
      ? calendario.dados.events
      : [];
    resultado.calendar = {
      ok: true,
      count: eventos.length,
      sample: eventos.slice(0, 5).map((evento) => ({
        name: evento.name,
        date: timestampParaIso(evento.timestart),
      })),
      error: null,
    };
  } else {
    resultado.calendar.error = calendario.error;
  }

  const cursos = await executarSeDisponivel(
    funcoes,
    'core_enrol_get_users_courses',
    () =>
      chamarWebservice(config, token, 'core_enrol_get_users_courses', {
        userid: siteInfo.userid,
      }),
  );

  if (!cursos.ok) {
    resultado.courses.error = cursos.error;
    resultado.contents.error = 'sem lista de cursos para testar';
    resultado.assignments.error = 'sem lista de cursos para testar';
    return resultado;
  }

  const listaCursos = Array.isArray(cursos.dados) ? cursos.dados : [];
  resultado.courses = {
    ok: true,
    count: listaCursos.length,
    sample: listaCursos.slice(0, 8).map((curso) => ({
      id: curso.id,
      shortname: curso.shortname,
      fullname: curso.fullname,
    })),
    error: null,
  };

  const primeiroCurso = listaCursos[0];

  if (!primeiroCurso) {
    resultado.contents.error = 'o utilizador não tem cursos inscritos';
    resultado.assignments.error = 'o utilizador não tem cursos inscritos';
    return resultado;
  }

  const conteudos = await executarSeDisponivel(
    funcoes,
    'core_course_get_contents',
    () =>
      chamarWebservice(config, token, 'core_course_get_contents', {
        courseid: primeiroCurso.id,
      }),
  );

  if (conteudos.ok) {
    const secoes = Array.isArray(conteudos.dados) ? conteudos.dados : [];
    const modulos = secoes.flatMap((secao) =>
      Array.isArray(secao.modules) ? secao.modules : [],
    );
    const modulosComFicheiros = modulos.filter((modulo) =>
      ['resource', 'folder', 'url', 'assign', 'quiz', 'forum', 'book'].includes(
        modulo.modname,
      ),
    );

    resultado.contents = {
      ok: true,
      sections: secoes.length,
      modules: modulos.length,
      fileModules: modulosComFicheiros.length,
      error: null,
    };
  } else {
    resultado.contents.error = conteudos.error;
  }

  const tarefas = await executarSeDisponivel(
    funcoes,
    'mod_assign_get_assignments',
    () =>
      chamarWebservice(config, token, 'mod_assign_get_assignments', {
        'courseids[0]': primeiroCurso.id,
      }),
  );

  if (tarefas.ok) {
    const cursosComTarefas = Array.isArray(tarefas.dados?.courses)
      ? tarefas.dados.courses
      : [];
    const listaTarefas = cursosComTarefas.flatMap((curso) =>
      Array.isArray(curso.assignments) ? curso.assignments : [],
    );
    resultado.assignments = {
      ok: true,
      count: listaTarefas.length,
      sample: listaTarefas.slice(0, 5).map((tarefa) => ({
        name: tarefa.name,
        dueDate: timestampParaIso(tarefa.duedate),
      })),
      error: null,
    };
  } else {
    resultado.assignments.error = tarefas.error;
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Testes ao iCal
// ---------------------------------------------------------------------------

function contarEventosIcal(texto) {
  return (texto.match(/^BEGIN:VEVENT/gm) || []).length;
}

async function testarPaginaExportacao(config) {
  try {
    const resposta = await pedido(
      urlDoMoodle(config.urlBase, 'calendar/export.php'),
    );
    const texto = await resposta.text();
    const localizacao = resposta.headers.get('location') || '';
    const redirecionaParaLogin = /login/i.test(localizacao);

    return {
      reachable: true,
      status: resposta.status,
      requiresLogin: redirecionaParaLogin,
      hasExportLink: /export_execute\.php/i.test(texto),
      error: null,
    };
  } catch (erro) {
    return {
      reachable: false,
      status: null,
      requiresLogin: null,
      hasExportLink: false,
      error: descreverErro(erro),
    };
  }
}

async function testarIcalConfigurado(config) {
  if (!config.iCalUrl) {
    return { configured: false, ok: false, events: 0, status: null, error: null };
  }

  try {
    // O URL pode conter um authtoken: não é impresso nem guardado no relatório.
    const resposta = await pedido(config.iCalUrl);
    const texto = await resposta.text();
    return {
      configured: true,
      ok: resposta.ok && /BEGIN:VCALENDAR/i.test(texto),
      events: contarEventosIcal(texto),
      status: resposta.status,
      error: null,
    };
  } catch (erro) {
    return {
      configured: true,
      ok: false,
      events: 0,
      status: null,
      error: descreverErro(erro),
    };
  }
}

// ---------------------------------------------------------------------------
// Login por formulário + iCal autenticado
// ---------------------------------------------------------------------------

class CookieJar {
  #cookies = new Map();

  absorver(resposta) {
    const linhas =
      typeof resposta.headers.getSetCookie === 'function'
        ? resposta.headers.getSetCookie()
        : [];

    for (const linha of linhas) {
      const par = linha.split(';')[0];
      const separador = par.indexOf('=');
      if (separador > 0) {
        this.#cookies.set(
          par.slice(0, separador).trim(),
          par.slice(separador + 1).trim(),
        );
      }
    }
  }

  cabecalho() {
    return [...this.#cookies]
      .map(([nome, valor]) => `${nome}=${valor}`)
      .join('; ');
  }
}

async function pedirComCookies(jar, url, opcoes = {}) {
  const cabecalhos = { ...(opcoes.headers || {}) };
  const cookie = jar.cabecalho();
  if (cookie) {
    cabecalhos.Cookie = cookie;
  }

  const resposta = await pedido(url, { ...opcoes, headers: cabecalhos });
  jar.absorver(resposta);
  return { resposta, texto: await resposta.text() };
}

function extrairValorInput(html, nome) {
  const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const padroes = [
    new RegExp(`name=["']${escapado}["'][^>]*value=["']([^"']+)["']`, 'i'),
    new RegExp(`value=["']([^"']+)["'][^>]*name=["']${escapado}["']`, 'i'),
  ];

  for (const padrao of padroes) {
    const resultado = html.match(padrao);
    if (resultado) {
      return resultado[1];
    }
  }

  return null;
}

function extrairAuthtoken(html) {
  const resultado = html.match(/authtoken=([A-Za-z0-9]+)/i);
  return resultado ? resultado[1] : null;
}

function detetarErroLogin(html) {
  if (/loginerrors|erroretry/i.test(html)) {
    return 'o Moodle rejeitou o formulário de login';
  }
  if (/nome de utilizador ou palavra-passe inválidos/i.test(html)) {
    return 'utilizador ou palavra-passe inválidos';
  }
  if (/invalid login|unrecognised username or password/i.test(html)) {
    return 'utilizador ou palavra-passe inválidos';
  }
  return null;
}

async function testarIcalAutenticado(config, jar, siteInfo) {
  try {
    const pagina = await pedirComCookies(
      jar,
      urlDoMoodle(config.urlBase, 'calendar/export.php'),
    );

    if (!/export_execute\.php/i.test(pagina.texto)) {
      return {
        ok: false,
        events: 0,
        error: 'a página de exportação não expõe export_execute.php',
      };
    }

    const authtoken = extrairAuthtoken(pagina.texto);
    const userid =
      pagina.texto.match(/userid=(\d+)/i)?.[1] ||
      (siteInfo?.userid ? String(siteInfo.userid) : null);

    if (!authtoken) {
      return {
        ok: false,
        events: 0,
        error:
          'exportação iCal disponível, mas o authtoken não foi encontrado no HTML; ' +
          'pode ser copiado manualmente para MOODLE_ICAL_URL',
      };
    }

    if (!userid) {
      return {
        ok: false,
        events: 0,
        error: 'authtoken encontrado, mas sem userid para construir o URL iCal',
      };
    }

    const url = new URL(
      urlDoMoodle(config.urlBase, 'calendar/export_execute.php'),
    );
    url.searchParams.set('userid', userid);
    url.searchParams.set('authtoken', authtoken);
    url.searchParams.set('preset_what', 'all');
    url.searchParams.set('preset_time', 'recentupcoming');

    const resposta = await pedirComCookies(jar, url.href);
    const ok =
      resposta.resposta.ok && /BEGIN:VCALENDAR/i.test(resposta.texto);

    return {
      ok,
      events: ok ? contarEventosIcal(resposta.texto) : 0,
      error: ok
        ? null
        : `export_execute.php devolveu HTTP ${resposta.resposta.status} sem calendário válido`,
    };
  } catch (erro) {
    return { ok: false, events: 0, error: descreverErro(erro) };
  }
}

async function testarLoginFormulario(config, siteInfo) {
  const resultado = {
    tested: false,
    ok: false,
    loginFormFound: false,
    ssoLikely: false,
    dashboardOk: false,
    courseLinks: 0,
    icalExportPageOk: false,
    icalAuthenticated: null,
    error: null,
  };

  if (!config.username || !config.password) {
    resultado.error =
      'sem MOODLE_USERNAME/MOODLE_PASSWORD; login por formulário não testado';
    return resultado;
  }

  resultado.tested = true;
  const jar = new CookieJar();
  const urlLogin = urlDoMoodle(config.urlBase, 'login/index.php');

  try {
    const paginaLogin = await pedirComCookies(jar, urlLogin);
    const logintoken = extrairValorInput(paginaLogin.texto, 'logintoken');

    resultado.loginFormFound = Boolean(logintoken);
    resultado.ssoLikely = /\/auth\/(shibboleth|saml2|oidc)|idp\/login/i.test(
      paginaLogin.texto,
    );

    if (!logintoken) {
      resultado.error =
        'formulário de login não encontrado na página; o Moodle pode usar SSO/Shibboleth';
      return resultado;
    }

    const corpo = new URLSearchParams({
      username: config.username,
      password: config.password,
      logintoken,
      anchor: '',
    });

    const envio = await pedirComCookies(jar, urlLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
    });

    const erroFormulario =
      envio.resposta.status === 200 ? detetarErroLogin(envio.texto) : null;

    if (erroFormulario) {
      resultado.error = erroFormulario;
      return resultado;
    }

    const minhaPagina = await pedirComCookies(
      jar,
      urlDoMoodle(config.urlBase, 'my/'),
    );

    const aindaNoLogin = /name=["']logintoken["']/i.test(minhaPagina.texto);
    resultado.dashboardOk =
      !aindaNoLogin &&
      /login\/logout\.php|page-my-index|sesskey=/i.test(minhaPagina.texto);

    if (!resultado.dashboardOk) {
      resultado.error =
        'o login não deu acesso ao painel; verifica credenciais, SSO ou bloqueios';
      return resultado;
    }

    resultado.ok = true;

    const idsCursos = new Set(
      [...minhaPagina.texto.matchAll(/course\/view\.php\?id=(\d+)/gi)].map(
        (resultadoCurso) => resultadoCurso[1],
      ),
    );
    resultado.courseLinks = idsCursos.size;

    const paginaExportacao = await pedirComCookies(
      jar,
      urlDoMoodle(config.urlBase, 'calendar/export.php'),
    );
    resultado.icalExportPageOk = /export_execute\.php/i.test(
      paginaExportacao.texto,
    );

    resultado.icalAuthenticated = await testarIcalAutenticado(
      config,
      jar,
      siteInfo,
    );
  } catch (erro) {
    resultado.error = descreverErro(erro);
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Recomendação e relatório
// ---------------------------------------------------------------------------

function recomendar(relatorio) {
  const tokenUtil =
    relatorio.token.ok &&
    (relatorio.webservice.courses.ok || relatorio.webservice.calendar.ok);

  if (tokenUtil) {
    return 'token';
  }
  if (relatorio.ical.direct?.ok || relatorio.ical.authenticated?.ok) {
    return 'ical';
  }
  if (relatorio.formLogin.ok) {
    return 'scraping';
  }
  return 'none';
}

function construirNotas(relatorio) {
  const notas = [];

  if (relatorio.token.error) {
    notas.push(`Token mobile: ${relatorio.token.error}.`);
  }

  if (relatorio.token.ok && !relatorio.webservice.calendar.error) {
    notas.push(
      `Calendário via API: ${relatorio.webservice.calendar.count} evento(s) nos próximos dias.`,
    );
  }

  if (relatorio.webservice.calendar.error) {
    notas.push(
      `Calendário via API indisponível: ${relatorio.webservice.calendar.error}.`,
    );
  }

  if (relatorio.formLogin.ssoLikely && !relatorio.formLogin.ok) {
    notas.push(
      'A página de login sugere SSO/Shibboleth; a password pode não funcionar em scripts. ' +
        'Nesse caso, usa MOODLE_TOKEN ou MOODLE_ICAL_URL.',
    );
  }

  if (relatorio.formLogin.ok && !relatorio.formLogin.icalAuthenticated?.ok) {
    notas.push(
      'A sessão por formulário funciona, mas o iCal não foi obtido automaticamente; ' +
        'podes copiar o URL de /calendar/export.php para MOODLE_ICAL_URL.',
    );
  }

  if (relatorio.ical.exportPage?.requiresLogin) {
    notas.push(
      'A exportação iCal exige sessão iniciada (redireciona para o login).',
    );
  }

  if (relatorio.recommendation === 'none') {
    notas.push(
      'Nenhuma fonte funcionou. Confirma MOODLE_URL e as credenciais, e verifica ' +
        'se a universidade permite web services mobile ou exportação iCal.',
    );
  }

  return notas;
}

async function escreverRelatorio(relatorio) {
  await mkdir(path.dirname(CAMINHO_RELATORIO), { recursive: true });
  await writeFile(
    CAMINHO_RELATORIO,
    `${JSON.stringify(relatorio, null, 2)}\n`,
    'utf8',
  );
}

function simNao(valor) {
  return valor ? '[OK]' : '[FALHA]';
}

function imprimirResumo(relatorio) {
  const { token, webservice, ical, formLogin } = relatorio;

  console.log('');
  console.log('=== Moodle Deadlines Dashboard — probe ===');
  console.log(`Moodle: ${relatorio.moodleUrl}`);
  console.log(`Node:   ${relatorio.nodeVersion}`);
  console.log('');

  console.log(`Token mobile: ${simNao(token.ok)}${token.source ? ` (${token.source})` : ''}`);
  if (token.error) {
    console.log(`  ${token.error}`);
  }

  if (webservice.siteInfo?.ok) {
    const totalFuncoes = webservice.siteInfo.functionCount;
    console.log(
      `  Site: ${webservice.siteInfo.siteName || '?'} | ` +
        `Moodle ${webservice.siteInfo.release || '?'} | ` +
        `${totalFuncoes} ${totalFuncoes === 1 ? 'função disponível' : 'funções disponíveis'}`,
    );
  }

  console.log(`Cursos: ${simNao(webservice.courses.ok)} (${webservice.courses.count})`);
  if (webservice.courses.error) {
    console.log(`  ${webservice.courses.error}`);
  }

  console.log(
    `Conteúdos do 1.º curso: ${simNao(webservice.contents.ok)} ` +
      `(${webservice.contents.sections} secções, ${webservice.contents.modules} módulos, ` +
      `${webservice.contents.fileModules} com ficheiros/atividades)`,
  );
  if (webservice.contents.error) {
    console.log(`  ${webservice.contents.error}`);
  }

  console.log(
    `Calendário via API: ${simNao(webservice.calendar.ok)} ` +
      `(${webservice.calendar.count} eventos)`,
  );
  if (webservice.calendar.error) {
    console.log(`  ${webservice.calendar.error}`);
  }

  console.log(
    `Tarefas (assign) via API: ${simNao(webservice.assignments.ok)} ` +
      `(${webservice.assignments.count})`,
  );
  if (webservice.assignments.error) {
    console.log(`  ${webservice.assignments.error}`);
  }

  console.log('');

  console.log(
    `Página de exportação iCal: ${simNao(ical.exportPage?.reachable)}` +
      (ical.exportPage?.status ? ` (HTTP ${ical.exportPage.status})` : '') +
      (ical.exportPage?.requiresLogin ? ' — exige login' : ''),
  );
  if (ical.exportPage?.error) {
    console.log(`  ${ical.exportPage.error}`);
  }

  if (ical.direct?.configured) {
    console.log(
      `URL iCal do .env: ${simNao(ical.direct.ok)} (${ical.direct.events} eventos)`,
    );
    if (ical.direct.error) {
      console.log(`  ${ical.direct.error}`);
    }
  } else {
    console.log('URL iCal do .env: não configurado');
  }

  if (formLogin.icalAuthenticated) {
    console.log(
      `iCal com sessão autenticada: ${simNao(formLogin.icalAuthenticated.ok)}` +
        (formLogin.icalAuthenticated.ok
          ? ` (${formLogin.icalAuthenticated.events} eventos)`
          : ''),
    );
    if (formLogin.icalAuthenticated.error) {
      console.log(`  ${formLogin.icalAuthenticated.error}`);
    }
  } else {
    console.log('iCal com sessão autenticada: não testado');
  }

  console.log('');

  console.log(
    `Login por formulário: ${simNao(formLogin.ok)}` +
      (formLogin.tested ? '' : ' (não testado)'),
  );
  if (formLogin.error) {
    console.log(`  ${formLogin.error}`);
  }
  if (formLogin.ok) {
    console.log(
      `  Painel acessível; ${formLogin.courseLinks} ligação(ões) a cursos encontradas.`,
    );
  }

  console.log('');
  const descricoes = {
    token: 'API com token (recomendada)',
    ical: 'exportação iCal',
    scraping: 'login por formulário + scraping',
    none: 'nenhuma fonte disponível',
  };
  console.log(`Recomendação: ${descricoes[relatorio.recommendation]}`);
  console.log(`Relatório: ${path.relative(process.cwd(), CAMINHO_RELATORIO)}`);

  if (relatorio.notes.length > 0) {
    console.log('');
    console.log('Notas:');
    for (const nota of relatorio.notes) {
      console.log(`  - ${nota}`);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

async function principal() {
  let config;
  try {
    config = obterConfigMoodle();
  } catch (erro) {
    console.error(`Configuração inválida: ${erro.message}`);
    console.error(
      'Copia .env.example para .env e preenche MOODLE_URL (e credenciais/token).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`A testar ${config.urlBase} (pedidos sequenciais, pausa ${PAUSA_MS} ms)...`);

  const relatorio = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    moodleUrl: config.urlBase,
    token: { source: null, ok: false, error: null },
    webservice: {
      siteInfo: { ok: false },
      courses: { ok: false, count: 0, sample: [], error: null },
      contents: { ok: false, sections: 0, modules: 0, fileModules: 0, error: null },
      calendar: { ok: false, count: 0, sample: [], error: null },
      assignments: { ok: false, count: 0, sample: [], error: null },
    },
    ical: { exportPage: null, direct: null, authenticated: null },
    formLogin: {
      tested: false,
      ok: false,
      loginFormFound: false,
      ssoLikely: false,
      dashboardOk: false,
      courseLinks: 0,
      icalExportPageOk: false,
      icalAuthenticated: null,
      error: null,
    },
    recommendation: 'none',
    notes: [],
    functionsTested: FUNCOES_WEBSERVICE,
  };

  const autenticacao = await obterToken(config, relatorio);
  relatorio.token = autenticacao.info;

  if (autenticacao.token && autenticacao.siteInfo) {
    relatorio.webservice = await testarFuncoesWebservice(
      config,
      autenticacao.token,
      autenticacao.siteInfo,
    );
  } else {
    relatorio.webservice.contents.error = 'sem token para testar';
    relatorio.webservice.calendar.error = 'sem token para testar';
    relatorio.webservice.assignments.error = 'sem token para testar';
  }

  relatorio.ical.exportPage = await testarPaginaExportacao(config);
  relatorio.ical.direct = await testarIcalConfigurado(config);

  relatorio.formLogin = await testarLoginFormulario(
    config,
    autenticacao.siteInfo,
  );
  relatorio.ical.authenticated = relatorio.formLogin.icalAuthenticated;

  relatorio.recommendation = recomendar(relatorio);
  relatorio.notes = construirNotas(relatorio);

  try {
    await escreverRelatorio(relatorio);
  } catch (erro) {
    console.error(`Não foi possível escrever o relatório: ${descreverErro(erro)}`);
    process.exitCode = 1;
    return;
  }

  imprimirResumo(relatorio);

  if (relatorio.recommendation === 'none') {
    process.exitCode = 2;
  }
}

await principal();
