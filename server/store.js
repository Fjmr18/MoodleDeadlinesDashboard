import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ_PROJETO, lerNumeroEnv } from './config.js';

const PASTA_DADOS = path.join(RAIZ_PROJETO, 'data');
const PASTA_CACHE = path.join(PASTA_DADOS, 'cache');
const FICHEIRO_CACHE = path.join(PASTA_CACHE, 'dashboard.json');
const FICHEIRO_OVERRIDES = path.join(PASTA_DADOS, 'overrides.json');

export const ACOES_REVISAO = new Set(['confirm', 'correct', 'dismiss']);

function minutosDeCache() {
  return lerNumeroEnv('CACHE_TTL_MINUTES', 15, 0);
}

/**
 * Indica se os dados ainda estão dentro do tempo de vida do cache.
 */
export function cacheValido(dados) {
  if (!dados?.geradoEm || !Array.isArray(dados.eventos)) {
    return false;
  }

  const geradoEm = new Date(dados.geradoEm).getTime();
  if (!Number.isFinite(geradoEm)) {
    return false;
  }

  return Date.now() - geradoEm < minutosDeCache() * 60 * 1000;
}

/**
 * Lê o último snapshot local. Um cache corrompido é tratado como inexistente:
 * o dashboard volta a pedir os dados ao Moodle.
 */
export async function lerCache() {
  try {
    const texto = await readFile(FICHEIRO_CACHE, 'utf8');
    const dados = JSON.parse(texto);
    return dados?.geradoEm && Array.isArray(dados.eventos) ? dados : null;
  } catch (erro) {
    if (erro.code === 'ENOENT' || erro instanceof SyntaxError) {
      return null;
    }
    throw erro;
  }
}

/**
 * Guarda os dados de forma atómica (ficheiro temporário + rename) para evitar
 * caches truncados se o processo for interrompido.
 */
export async function guardarCache(dados) {
  await mkdir(PASTA_CACHE, { recursive: true });
  const temporario = `${FICHEIRO_CACHE}.tmp`;
  await writeFile(temporario, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
  await rename(temporario, FICHEIRO_CACHE);
}

/**
 * Idade do snapshot em minutos, arredondada para baixo.
 */
export function idadeCacheMinutos(dados) {
  const geradoEm = new Date(dados?.geradoEm).getTime();
  if (!Number.isFinite(geradoEm)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - geradoEm) / 60000));
}

/**
 * Lê as decisões manuais sobre eventos extraídos. O ficheiro é opcional: sem
 * ele, todos os eventos de ficheiros continuam por rever.
 */
export async function lerOverrides() {
  try {
    const texto = await readFile(FICHEIRO_OVERRIDES, 'utf8');
    const dados = JSON.parse(texto);
    const eventos = dados?.eventos;

    if (!eventos || typeof eventos !== 'object' || Array.isArray(eventos)) {
      return {};
    }

    return eventos;
  } catch (erro) {
    if (erro.code === 'ENOENT' || erro instanceof SyntaxError) {
      return {};
    }
    throw erro;
  }
}

/**
 * Guarda as decisões de revisão de forma atómica, tal como o cache.
 */
export async function guardarOverrides(eventos) {
  await mkdir(PASTA_DADOS, { recursive: true });
  const temporario = `${FICHEIRO_OVERRIDES}.tmp`;
  const dados = {
    versao: 1,
    atualizadoEm: new Date().toISOString(),
    eventos,
  };

  await writeFile(temporario, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
  await rename(temporario, FICHEIRO_OVERRIDES);
}

function copiarEvento(evento) {
  return {
    ...evento,
    source: evento.source ? { ...evento.source } : evento.source,
    review: evento.review ? { ...evento.review } : evento.review,
  };
}

/**
 * Aplica as decisões manuais a uma lista de eventos. Eventos confirmados ou
 * corrigidos contam como oficiais no dashboard; os descartados permanecem na
 * lista com `status: "dismissed"` para poderem ser recuperados.
 */
export function aplicarOverrides(eventos = [], overrides = {}) {
  const resultado = [];
  const resumo = { porRever: 0, confirmadas: 0, descartadas: 0, corrigidas: 0 };

  for (const evento of eventos) {
    const copia = copiarEvento(evento);
    const override = overrides[copia.id];

    if (override && copia.id.startsWith('ficheiro-')) {
      copia.review = {
        ...(copia.review || {}),
        acao: override.action,
        atualizadoEm: override.atualizadoEm || null,
      };

      if (override.action === 'dismiss') {
        copia.status = 'dismissed';
      } else if (override.action === 'correct') {
        copia.status = 'confirmed';
        copia.dateConfidence = 'exact';

        if (override.date) {
          copia.date = override.date;
        }

        if (override.title) {
          copia.title = override.title;
        }

        copia.review.corrigida = true;
        resumo.corrigidas += 1;
      } else {
        copia.status = 'confirmed';
      }
    }

    if (copia.status === 'needs-review') {
      resumo.porRever += 1;
    } else if (copia.status === 'dismissed') {
      resumo.descartadas += 1;
    } else if (copia.source?.kind === 'file') {
      resumo.confirmadas += 1;
    }

    resultado.push(copia);
  }

  resultado.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.course).localeCompare(String(b.course), 'pt'),
  );

  return { eventos: resultado, resumo };
}
