import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Raiz do projeto calculada a partir deste ficheiro, para funcionar em qualquer
// sistema operativo e independentemente da pasta de onde o processo arranca.
export const RAIZ_PROJETO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

let envCarregado = false;

/**
 * Carrega o ficheiro .env para process.env. Variáveis já definidas no ambiente
 * têm prioridade (útil para testes e para `MOODLE_URL=... npm run probe`).
 * A ausência de .env não é fatal: a validação acontece ao pedir a configuração.
 */
export function carregarEnv(caminho = path.join(RAIZ_PROJETO, '.env')) {
  if (envCarregado) {
    return;
  }

  try {
    process.loadEnvFile(caminho);
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      throw new Error(
        `Não foi possível ler o ficheiro .env (${erro.message}).`,
        { cause: erro },
      );
    }
  }

  envCarregado = true;
}

/**
 * Lê uma variável de ambiente com valor por defeito e remove espaços extra.
 */
function lerEnv(nome, defeito = '') {
  const valor = process.env[nome];
  return valor === undefined ? defeito : valor.trim();
}

/**
 * Valida e normaliza o URL base do Moodle. Remove query string, fragmento e
 * garante barra final para que `new URL(caminho, base)` preserve subdiretórios
 * (instalações Moodle em /moodle, por exemplo).
 */
export function normalizarUrlBase(valor) {
  const bruto = (valor || '').trim();

  if (!bruto) {
    throw new Error(
      'MOODLE_URL não está definido. Copia .env.example para .env e preenche o URL.',
    );
  }

  let url;
  try {
    url = new URL(bruto);
  } catch {
    throw new Error(`MOODLE_URL inválido: "${bruto}". Exemplo: https://moodle.exemplo.pt`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('MOODLE_URL tem de começar por http:// ou https://.');
  }

  url.search = '';
  url.hash = '';
  url.username = '';
  url.password = '';
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }

  return url.href;
}

/**
 * Junta um caminho relativo ao URL base do Moodle, respeitando subdiretórios.
 */
export function urlDoMoodle(urlBase, caminho) {
  return new URL(String(caminho).replace(/^\/+/, ''), urlBase).href;
}

/**
 * Configuração do Moodle. Não exige credenciais: o probe e o servidor decidem
 * qual das fontes (token, iCal ou sessão) é que está disponível.
 */
export function obterConfigMoodle() {
  return {
    urlBase: normalizarUrlBase(process.env.MOODLE_URL),
    username: lerEnv('MOODLE_USERNAME'),
    password: process.env.MOODLE_PASSWORD || '',
    token: lerEnv('MOODLE_TOKEN'),
    service: lerEnv('MOODLE_SERVICE', 'moodle_mobile_app'),
    iCalUrl: lerEnv('MOODLE_ICAL_URL'),
  };
}

/**
 * Configuração usada para converter "semana N" em datas. A ausência de
 * `SEMESTER_START` não é fatal: nesse caso as semanas ficam por converter.
 */
export function obterConfigSemestre() {
  const inicio = lerEnv('SEMESTER_START', '');
  const fuso = lerEnv('SEMESTER_TIMEZONE', 'Europe/Lisbon') || 'Europe/Lisbon';

  if (inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
    throw new Error('SEMESTER_START tem de estar no formato AAAA-MM-DD.');
  }

  return {
    inicio: inicio || null,
    fuso,
  };
}

/**
 * Configuração do servidor. O anfitrião é fixo por segurança: a aplicação é
 * local e não deve ficar acessível a partir da rede.
 */
export function obterConfigServidor() {
  const porta = Number(lerEnv('PORT', '3000'));

  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error('PORT tem de ser um número inteiro entre 1 e 65535.');
  }

  return {
    anfitriao: '127.0.0.1',
    porta,
  };
}

/**
 * Lê uma variável numérica, com validação e limite mínimo.
 */
export function lerNumeroEnv(nome, defeito, minimo = 0) {
  const bruto = lerEnv(nome, String(defeito));
  const numero = Number(bruto);

  if (!Number.isFinite(numero) || numero < minimo) {
    throw new Error(`${nome} tem de ser um número maior ou igual a ${minimo}.`);
  }

  return numero;
}
