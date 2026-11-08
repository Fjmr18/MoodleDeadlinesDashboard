import { access, chmod, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ_PROJETO, normalizarUrlBase } from './config.js';

const CAMINHO_ENV = path.join(RAIZ_PROJETO, '.env');
const CAMINHO_SNAPSHOT = path.join(RAIZ_PROJETO, 'data', 'cache', 'dashboard.json');
const URL_BASE_POR_DEFEITO = 'https://moodle.unips.pt';

// A partir de agosto considera-se que o ano letivo seguinte já é o corrente.
const MES_INICIO_ANO_LETIVO = 7;

// O token do Moodle é uma cadeia curta e alfanumérica. Validar o formato evita
// que um valor inesperado estrague a linha do .env.
const PADRAO_TOKEN = /^[A-Za-z0-9._~-]{8,200}$/;

function normalizarData(valor) {
  const bruto = String(valor ?? '').trim();

  if (!bruto) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
    throw new Error('A data de início do semestre tem de estar no formato AAAA-MM-DD.');
  }

  const [ano, mes, dia] = bruto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));

  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    throw new Error('A data de início do semestre não existe no calendário.');
  }

  return bruto;
}

/**
 * Ano letivo no formato `2627`. Entre agosto e dezembro usa o ano civil
 * corrente; de janeiro a julho usa o ano anterior.
 */
export function anoLetivoAtual(agora = new Date()) {
  const anoInicio =
    agora.getMonth() >= MES_INICIO_ANO_LETIVO
      ? agora.getFullYear()
      : agora.getFullYear() - 1;

  return `${String(anoInicio % 100).padStart(2, '0')}${String(
    (anoInicio + 1) % 100,
  ).padStart(2, '0')}`;
}

export function normalizarAnoLetivo(valor) {
  const bruto = String(valor ?? '').trim();

  if (!/^\d{4}$/.test(bruto)) {
    throw new Error('O ano letivo tem de ter quatro dígitos (por exemplo, 2627).');
  }

  const inicio = Number(bruto.slice(0, 2));
  const fim = Number(bruto.slice(2));

  if (fim !== (inicio + 1) % 100) {
    throw new Error('O ano letivo tem de ser um par consecutivo (por exemplo, 2627).');
  }

  return bruto;
}

export function urlBaseMoodle() {
  return normalizarUrlBase(process.env.MOODLE_BASE_URL || URL_BASE_POR_DEFEITO);
}

/**
 * Constrói o URL do Moodle para o ano letivo indicado, preservando eventuais
 * subdiretórios da instalação.
 */
export function construirUrlMoodle(anoLetivo, base = urlBaseMoodle()) {
  const ano = normalizarAnoLetivo(anoLetivo);
  return new URL(`${ano}/`, normalizarUrlBase(base)).href;
}

/**
 * Sugestão editável para o primeiro dia de aulas. O utilizador pode corrigir a
 * data no assistente; sem ela, as referências a "semana N" não são convertidas.
 */
export function semestreInicioSugerido(anoLetivo) {
  const ano = normalizarAnoLetivo(anoLetivo);
  return `${2000 + Number(ano.slice(0, 2))}-09-14`;
}

export function validarConfiguracaoInicial({
  anoLetivo,
  numeroAluno,
  password,
  semestreInicio,
} = {}) {
  const ano = normalizarAnoLetivo(anoLetivo ?? anoLetivoAtual());
  const numero = String(numeroAluno ?? '').trim();

  if (!numero) {
    throw new Error('Indica o número de aluno.');
  }

  if (numero.length > 120 || !/^[A-Za-z0-9._@+-]+$/.test(numero)) {
    throw new Error('O número de aluno tem caracteres inválidos.');
  }

  const palavraPasse = String(password ?? '');

  if (!palavraPasse) {
    throw new Error('Indica a palavra-passe.');
  }

  if (palavraPasse.length > 200) {
    throw new Error('A palavra-passe é demasiado longa.');
  }

  if (/[\u0000-\u001f\u007f]/.test(palavraPasse)) {
    throw new Error('A palavra-passe contém caracteres inválidos.');
  }

  return {
    anoLetivo: ano,
    numeroAluno: numero,
    password: palavraPasse,
    semestreInicio: normalizarData(semestreInicio),
  };
}

/**
 * Indica se ainda falta configurar uma forma de autenticação. Um token é
 * suficiente; sem token são necessários utilizador e palavra-passe.
 */
export function configuracaoPendente(env = process.env) {
  const url = String(env.MOODLE_URL || '').trim();
  const token = String(env.MOODLE_TOKEN || '').trim();
  const utilizador = String(env.MOODLE_USERNAME || '').trim();
  const password = String(env.MOODLE_PASSWORD || '');

  if (!url) {
    return true;
  }

  if (token) {
    return false;
  }

  return !(utilizador && password);
}

async function existeFicheiro(caminho) {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

export async function obterEstadoConfiguracao() {
  return {
    pendente: configuracaoPendente(),
    existeEnv: await existeFicheiro(CAMINHO_ENV),
    anoLetivoPorDefeito: anoLetivoAtual(),
    semestreInicioSugerido: semestreInicioSugerido(anoLetivoAtual()),
    urlBase: urlBaseMoodle(),
  };
}

function aspasEnv(valor, nome) {
  const texto = String(valor);

  if (/["\\\r\n\u0000]/.test(texto)) {
    throw new Error(`O valor de ${nome} não pode ser guardado no .env.`);
  }

  return `"${texto}"`;
}

/**
 * Gera o conteúdo do .env. A palavra-passe não faz parte deste conteúdo: o
 * assistente troca-a por um token antes de escrever o ficheiro.
 */
export function gerarConteudoEnv({
  urlMoodle,
  numeroAluno,
  token,
  semestreInicio,
} = {}) {
  const url = normalizarUrlBase(urlMoodle);
  const utilizador = String(numeroAluno ?? '').trim();
  const tokenLimpo = String(token ?? '').trim();

  if (!utilizador) {
    throw new Error('Falta o número de aluno para guardar no .env.');
  }

  if (!PADRAO_TOKEN.test(tokenLimpo)) {
    throw new Error(
      'O Moodle devolveu um token com um formato inesperado. Configura MOODLE_TOKEN manualmente.',
    );
  }

  const linhas = [
    '# ============================================================',
    '# Gerado pelo assistente de configuração do dashboard.',
    '# Contém um token de acesso: NÃO versionar este ficheiro.',
    '# ============================================================',
    '',
    `MOODLE_URL=${aspasEnv(url, 'MOODLE_URL')}`,
    `MOODLE_USERNAME=${aspasEnv(utilizador, 'MOODLE_USERNAME')}`,
    `MOODLE_TOKEN=${aspasEnv(tokenLimpo, 'MOODLE_TOKEN')}`,
    '',
    'SEMESTER_TIMEZONE=Europe/Lisbon',
  ];

  const semestre = normalizarData(semestreInicio);

  if (semestre) {
    linhas.push(`SEMESTER_START=${semestre}`);
  }

  return `${linhas.join('\n')}\n`;
}

/**
 * Escreve o .env com permissões restritas e aplica os valores ao processo atual,
 * sem obrigar a reiniciar o servidor.
 */
export async function guardarConfiguracaoInicial({
  urlMoodle,
  numeroAluno,
  token,
  semestreInicio,
} = {}) {
  const conteudo = gerarConteudoEnv({
    urlMoodle,
    numeroAluno,
    token,
    semestreInicio,
  });

  try {
    await writeFile(CAMINHO_ENV, conteudo, { mode: 0o600 });
    await chmod(CAMINHO_ENV, 0o600);
  } catch (erro) {
    throw new Error(
      `Não foi possível escrever o ficheiro .env (${erro.code || erro.message}).`,
      { cause: erro },
    );
  }

  process.env.MOODLE_URL = normalizarUrlBase(urlMoodle);
  process.env.MOODLE_USERNAME = String(numeroAluno).trim();
  process.env.MOODLE_TOKEN = String(token).trim();
  delete process.env.MOODLE_PASSWORD;
  process.env.SEMESTER_TIMEZONE = 'Europe/Lisbon';

  const semestre = normalizarData(semestreInicio);

  if (semestre) {
    process.env.SEMESTER_START = semestre;
  } else {
    delete process.env.SEMESTER_START;
  }
}

/**
 * O snapshot pode pertencer a uma configuração anterior. É removido no fim da
 * configuração para não mostrar dados de outra conta se o Moodle falhar.
 */
export async function limparSnapshotDashboard() {
  try {
    await rm(CAMINHO_SNAPSHOT, { force: true });
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      throw erro;
    }
  }
}
