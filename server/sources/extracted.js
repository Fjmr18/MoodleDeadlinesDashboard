import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ_PROJETO, obterConfigSemestre } from '../config.js';
import { extrairDatasDoTexto, normalizarParaComparacao } from '../parsers/dates.js';
import { lerInventarioFicheiros } from './files.js';

const PASTA_TEXTO = path.join(RAIZ_PROJETO, 'data', 'cache', 'texto');
const VERSAO_PARSER = '3';

// Datas muito antigas vêm normalmente de enunciados de anos anteriores. A
// janela letiva evita que poluam o dashboard sem esconder entregas de setembro.
const MARGEM_ANTES_DIAS = 45;
const JANELA_DEPOIS_DIAS = 400;

/**
 * Calcula a janela de datas plausíveis para o ano letivo em curso. Se não
 * houver `SEMESTER_START`, usa a data atual como referência.
 */
export function criarLimitesPeriodo({ inicioSemestre = null, agora = new Date() } = {}) {
  let referencia;

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(inicioSemestre || ''))) {
    const [ano, mes, dia] = String(inicioSemestre).split('-').map(Number);
    referencia = Date.UTC(ano, mes - 1, dia);
  } else {
    referencia = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  }

  return {
    inicio: new Date(referencia - MARGEM_ANTES_DIAS * 86400000).toISOString(),
    fim: new Date(referencia + JANELA_DEPOIS_DIAS * 86400000).toISOString(),
  };
}

export function dentroDoPeriodo(dataIso, limites) {
  if (!limites || !dataIso) {
    return true;
  }

  return dataIso >= limites.inicio && dataIso <= limites.fim;
}

let cache = {
  assinatura: null,
  eventos: [],
  resumo: {
    ficheirosAnalisados: 0,
    paginasAnalisadas: 0,
    eventos: 0,
    descartadosForaDoPeriodo: 0,
    porConfianca: { exact: 0, 'week-based': 0, unclear: 0 },
  },
};

async function lerTextoCache(chave) {
  try {
    const conteudo = await readFile(path.join(PASTA_TEXTO, `${chave}.json`), 'utf8');
    const dados = JSON.parse(conteudo);
    return dados && typeof dados.texto === 'string' ? dados : null;
  } catch (erro) {
    if (erro.code === 'ENOENT' || erro instanceof SyntaxError) {
      return null;
    }
    throw erro;
  }
}

function assinaturaDoInventario(inventario) {
  const partes = (inventario?.ficheiros || []).map((item) => [
    item.id,
    item.estado,
    item.analisadoEm,
    item.caracteres,
    item.paginas,
  ]);

  return createHash('sha1')
    .update(`${VERSAO_PARSER}|${JSON.stringify(partes)}`)
    .digest('hex');
}

function localDaPagina(tipoTexto, pagina) {
  const tipo = tipoTexto === 'pptx' ? 'slide' : 'página';
  return `${tipo} ${Number(pagina?.numero) || 1}`;
}

/**
 * Converte um candidato do parser num evento normalizado. O texto completo do
 * ficheiro nunca é incluído: apenas o pequeno trecho de contexto.
 */
export function construirEventoExtraido(item, pagina, candidato, tipoTexto) {
  const baseId = [
    item.id,
    pagina.numero,
    candidato.date,
    normalizarParaComparacao(candidato.title),
    String(candidato.snippet || '').slice(0, 120),
  ].join('|');

  return {
    id: `ficheiro-${item.id}-${createHash('sha1').update(baseId).digest('hex').slice(0, 12)}`,
    courseId: Number(item.cursoId) || null,
    course: item.curso || 'Sem cadeira',
    courseShort: item.cursoCurto || '—',
    type: candidato.type,
    title: candidato.title,
    date: candidato.date,
    dateConfidence: candidato.dateConfidence,
    source: {
      kind: 'file',
      file: item.nome,
      location: localDaPagina(tipoTexto, pagina),
      snippet: candidato.snippet,
      url: null,
    },
    status: 'needs-review',
    review: {
      originalDate: candidato.date,
      originalTitle: candidato.title,
      parser: `datas-${VERSAO_PARSER}`,
      semana: candidato.semana ?? null,
    },
  };
}

/**
 * Lê o inventário e o texto em cache e devolve os eventos extraídos dos
 * ficheiros. O resultado é memorizado até o inventário mudar.
 */
export async function obterEventosExtraidos() {
  const inventario = await lerInventarioFicheiros();

  if (!inventario?.ficheiros?.length) {
    cache = {
      assinatura: null,
      eventos: [],
      resumo: {
        ficheirosAnalisados: 0,
        paginasAnalisadas: 0,
        eventos: 0,
        descartadosForaDoPeriodo: 0,
        porConfianca: { exact: 0, 'week-based': 0, unclear: 0 },
      },
    };
    return cache;
  }

  const assinatura = assinaturaDoInventario(inventario);

  if (cache.assinatura === assinatura) {
    return cache;
  }

  const config = obterConfigSemestre();
  const limites = criarLimitesPeriodo({ inicioSemestre: config.inicio });
  const eventos = [];
  const ids = new Set();
  const porConfianca = { exact: 0, 'week-based': 0, unclear: 0 };
  let ficheirosAnalisados = 0;
  let paginasAnalisadas = 0;
  let descartadosForaDoPeriodo = 0;

  for (const item of inventario.ficheiros) {
    if (item.estado !== 'extraido') {
      continue;
    }

    const texto = await lerTextoCache(item.id);

    if (!texto) {
      continue;
    }

    ficheirosAnalisados += 1;
    const paginas =
      Array.isArray(texto.paginas) && texto.paginas.length > 0
        ? texto.paginas
        : [{ numero: 1, texto: texto.texto }];
    // O mesmo prazo aparece repetido em várias páginas de um PDF. Dentro do
    // mesmo ficheiro guarda-se apenas a primeira ocorrência.
    const chavesDoFicheiro = new Set();

    for (const pagina of paginas) {
      if (!pagina || typeof pagina.texto !== 'string' || !pagina.texto.trim()) {
        continue;
      }

      paginasAnalisadas += 1;
      const candidatos = extrairDatasDoTexto(pagina.texto, {
        inicioSemestre: config.inicio,
        fuso: config.fuso,
        nomeFicheiro: item.nome,
      });

      for (const candidato of candidatos) {
        if (!dentroDoPeriodo(candidato.date, limites)) {
          descartadosForaDoPeriodo += 1;
          continue;
        }

        const chave = `${candidato.date}|${normalizarParaComparacao(candidato.title)}`;

        if (chavesDoFicheiro.has(chave)) {
          continue;
        }

        chavesDoFicheiro.add(chave);
        const evento = construirEventoExtraido(item, pagina, candidato, texto.tipo);

        if (ids.has(evento.id)) {
          continue;
        }

        ids.add(evento.id);
        eventos.push(evento);

        if (porConfianca[evento.dateConfidence] !== undefined) {
          porConfianca[evento.dateConfidence] += 1;
        }
      }
    }
  }

  eventos.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.course.localeCompare(b.course) ||
      a.title.localeCompare(b.title),
  );

  cache = {
    assinatura,
    eventos,
    resumo: {
      ficheirosAnalisados,
      paginasAnalisadas,
      eventos: eventos.length,
      descartadosForaDoPeriodo,
      porConfianca,
    },
  };

  return cache;
}

/**
 * Invalida a memória do parser. Útil depois de uma nova análise de ficheiros.
 */
export function limparCacheEventosExtraidos() {
  cache = { ...cache, assinatura: null };
}
