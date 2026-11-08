// Utilitários de texto, classificação e extração de datas dos ficheiros do
// Moodle. As datas extraídas são sempre sugestões: a confirmação é manual.

import { criarDataNoFuso, extrairSemanasDoTexto } from './semesterWeeks.js';

const ENTIDADES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// Nomes dos meses, incluindo abreviaturas. O padrão aceita espaços entre as
// letras porque alguns PDFs partem palavras ("dez embro", "set embro").
const MESES = [
  { numero: 1, padrao: 'j\\s?a\\s?n\\s?e\\s?i\\s?r\\s?o' },
  { numero: 2, padrao: 'f\\s?e\\s?v\\s?e\\s?r\\s?e\\s?i\\s?r\\s?o' },
  { numero: 3, padrao: 'm\\s?a\\s?r\\s?[cç]\\s?o' },
  { numero: 4, padrao: 'a\\s?b\\s?r\\s?i\\s?l' },
  { numero: 5, padrao: 'm\\s?a\\s?i\\s?o' },
  { numero: 6, padrao: 'j\\s?u\\s?n\\s?h\\s?o' },
  { numero: 7, padrao: 'j\\s?u\\s?l\\s?h\\s?o' },
  { numero: 8, padrao: 'a\\s?g\\s?o\\s?s\\s?t\\s?o' },
  { numero: 9, padrao: 's\\s?e\\s?t\\s?e\\s?m\\s?b\\s?r\\s?o' },
  { numero: 10, padrao: 'o\\s?u\\s?t\\s?u\\s?b\\s?r\\s?o' },
  { numero: 11, padrao: 'n\\s?o\\s?v\\s?e\\s?m\\s?b\\s?r\\s?o' },
  { numero: 12, padrao: 'd\\s?e\\s?z\\s?e\\s?m\\s?b\\s?r\\s?o' },
  { numero: 1, padrao: 'j\\s?a\\s?n' },
  { numero: 2, padrao: 'f\\s?e\\s?v' },
  { numero: 3, padrao: 'm\\s?a\\s?r' },
  { numero: 4, padrao: 'a\\s?b\\s?r' },
  { numero: 5, padrao: 'm\\s?a\\s?i' },
  { numero: 6, padrao: 'j\\s?u\\s?n' },
  { numero: 7, padrao: 'j\\s?u\\s?l' },
  { numero: 8, padrao: 'a\\s?g\\s?o' },
  { numero: 9, padrao: 's\\s?e\\s?t' },
  { numero: 10, padrao: 'o\\s?u\\s?t' },
  { numero: 11, padrao: 'n\\s?o\\s?v' },
  { numero: 12, padrao: 'd\\s?e\\s?z' },
];

const MESES_POR_NOME = new Map(
  MESES.map(({ numero, padrao }) => [padrao.replace(/\\s\?/g, '').replace(/\[cç\]/g, 'c'), numero]),
);

const ALTERNATIVAS_MES = MESES.map(({ padrao }) => padrao).join('|');

const RE_DATA_TEXTO = new RegExp(
  `\\b(\\d{1,2})(?:\\s*\\.\\s*[º°ª]?|\\s*[º°ª])?\\s+(?:de\\s+)?(${ALTERNATIVAS_MES})(?![\\p{L}])(?:\\s+(?:de\\s+)?(\\d{4}|\\d{2}))?`,
  'giu',
);

const RE_DATA_NUMERICA = /\b(\d{1,2})\s*([/\-.])\s*(\d{1,2})\s*\2\s*(\d{2,4})\b/g;

const PALAVRAS_EVENTO =
  /(?:^|\b)(teste|mini-?teste|frequencia|exame|entrega|entregar|projeto|trabalho|relatorio|apresentacao|prazo|milestone|submissao|prova|quiz|defesa|avaliacao)(?:\b|$)/i;

const CONTEXTO_IRRELEVANTE =
  /diario da republica|regulamento|despacho|portaria|legislacao|copyright|isbn|issn|doi|documento criado|elaborado em|atualizado em|impresso em|printed|generated|data de nascimento|nascimento|validade|cartao de cidadao|contrato/i;

const CONTEXTO_SEMANA_IRRELEVANTE =
  /por semana|horas por semana|aulas por semana|carga semanal|semanal/i;

const ROTULOS_TITULO = [
  /milestone\s*\d+\s*[—–-]?\s*[^·]{0,90}/i,
  /documenta[cç][aã]o\s+a\s+entregar/i,
  /(?:mini-?teste|teste)\s*(?:n[º°o.]?\s*)?\d*\s*[^:;.]{0,70}/i,
  /frequ[eê]ncia\s*[^:;.]{0,70}/i,
  /exame(?:\s+de)?\s*[^:;.]{0,70}/i,
  /entregar\s*[^:;.]{0,70}/i,
  /entrega\s*(?:do|da|de)?\s*[^:;.]{0,70}/i,
  /projeto\s*(?:n[º°o.]?\s*)?\d*\s*[^:;.]{0,70}/i,
  /trabalho\s*[^:;.]{0,70}/i,
  /relat[oó]rio\s*[^:;.]{0,70}/i,
  /apresenta[cç][aã]o\s*[^:;.]{0,70}/i,
  /avalia[cç][aã]o\s*[^:;.]{0,70}/i,
];

const PREFIXO_PRAZO =
  /^(termina o prazo de|termina o prazo|fecha|inicia|comeca|começa|abre)\s+['"“”‘’](.+?)['"“”‘’]\s*$/i;

const LIMITE_SNIPPET = 280;

/**
 * Descodifica as entidades HTML mais comuns devolvidas pelo Moodle.
 * Algumas instalações devolvem `&#039;` em vez de apóstrofos.
 */
export function descodificarEntidades(texto = '') {
  return String(texto).replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (original, codigo) => {
    if (codigo.startsWith('#')) {
      const hexadecimal = codigo[1] === 'x' || codigo[1] === 'X';
      const numero = Number.parseInt(hexadecimal ? codigo.slice(2) : codigo.slice(1), hexadecimal ? 16 : 10);

      if (Number.isFinite(numero) && numero > 0 && numero <= 0x10ffff) {
        try {
          return String.fromCodePoint(numero);
        } catch {
          return original;
        }
      }

      return original;
    }

    return ENTIDADES[codigo.toLowerCase()] ?? original;
  });
}

/**
 * Converte HTML do Moodle em texto simples de uma só linha.
 */
export function limparHtml(texto = '') {
  const semEtiquetas = String(texto)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|div|h[1-6]|tr|td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  return descodificarEntidades(semEtiquetas).replace(/\s+/g, ' ').trim();
}

/**
 * Normaliza texto para comparações: sem acentos, minúsculas e sem pontuação.
 */
export function normalizarParaComparacao(texto = '') {
  return limparHtml(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Prepara texto extraído de PDF/PPTX para a procura de datas. Além de colapsar
 * espaços, corrige anos partidos por quebras de linha ("202 6" → "2026").
 */
export function normalizarTextoExtraido(texto = '') {
  let normalizado = String(texto)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  // "202 6" e "202 7" são frequentes em tabelas de PDF.
  normalizado = normalizado.replace(/\b((?:19|20)\d)\s(\d)\b/g, '$1$2');
  // Alguns PDFs separam mesmo os três dígitos do ano ("20 2 6").
  normalizado = normalizado.replace(/\b(20)\s(\d)\s(\d)\b/g, '$1$2$3');

  return normalizado;
}

function numeroDoMes(texto) {
  const chave = String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');

  return MESES_POR_NOME.get(chave) ?? null;
}

function dataValida(ano, mes, dia) {
  const data = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia
  );
}

function referenciaDoAno(inicioSemestre, agora) {
  const partes = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(inicioSemestre || ''));

  if (partes) {
    return { ano: Number(partes[1]), mes: Number(partes[2]) };
  }

  const ano = agora.getFullYear();
  return agora.getMonth() >= 8 ? { ano, mes: 9 } : { ano: ano - 1, mes: 9 };
}

function inferirAno(mes, inicioSemestre, agora) {
  const referencia = referenciaDoAno(inicioSemestre, agora);
  return mes < referencia.mes ? referencia.ano + 1 : referencia.ano;
}

function normalizarAno(valor) {
  const numero = Number(valor);

  if (!Number.isInteger(numero)) {
    return null;
  }

  if (numero >= 100) {
    return numero;
  }

  return 2000 + numero;
}

function extrairHora(texto, inicio, fim) {
  const depois = texto.slice(fim, Math.min(texto.length, fim + 90));
  const antes = texto.slice(Math.max(0, inicio - 35), inicio);
  const expressoes = [
    /(?:às|as|pelas)\s*(\d{1,2})(?:\s*[:hH]\s*(\d{2}))?\s*(?:h|horas)?/i,
    /\b(\d{1,2})\s*[:hH]\s*(\d{2})\b/,
  ];

  for (const trecho of [depois, antes]) {
    for (const expressao of expressoes) {
      const resultado = expressao.exec(trecho);

      if (!resultado) {
        continue;
      }

      const hora = Number(resultado[1]);
      const minuto = Number(resultado[2] || 0);

      if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59) {
        return { hora, minuto };
      }
    }
  }

  return null;
}

function limparRotulo(valor = '') {
  let texto = String(valor).replace(/\s+/g, ' ').trim();
  texto = texto.split(/documento\s*:|prazo\s*:|data\s*:|·/i)[0].trim();
  // Um título nunca deve incluir a data que está a ser extraída.
  texto = texto.replace(/\b\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}\b/g, ' ');
  texto = texto.replace(/^[\s:–—-]+|[\s:–—.-]+$/g, '').trim();

  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    texto = texto
      .replace(
        /(?:^|\s)(?:a|à|as|às|o|os|do|da|dos|das|de|em|na|no|nas|nos|para|por|é|e|até)\s*$/iu,
        '',
      )
      .trim();
  }

  if (texto.length > 90) {
    texto = `${texto.slice(0, 89).trimEnd()}…`;
  }

  return texto.replace(/^./, (letra) => letra.toUpperCase());
}

function tituloDoFicheiro(nome = '') {
  return String(nome)
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([^\d\s])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letra) => letra.toUpperCase());
}

function ultimoResultado(expressao, texto) {
  const global = new RegExp(expressao.source, `${expressao.flags.replace('g', '')}g`);
  let resultado;
  let ultimo = null;

  while ((resultado = global.exec(texto)) !== null) {
    ultimo = resultado;

    if (resultado[0].length === 0) {
      global.lastIndex += 1;
    }
  }

  return ultimo;
}

function ajustarTitulo(titulo, nomeFicheiro) {
  const doFicheiro = tituloDoFicheiro(nomeFicheiro);

  if (!doFicheiro) {
    return titulo;
  }

  const tituloNormalizado = normalizarParaComparacao(titulo);
  const ficheiroNormalizado = normalizarParaComparacao(doFicheiro);

  if (
    /^\s*projeto\b/.test(tituloNormalizado) &&
    /^\s*projeto\b/.test(ficheiroNormalizado)
  ) {
    return doFicheiro;
  }

  if (
    /^(documentacao a entregar|entrega|entregar)\b/.test(tituloNormalizado) &&
    /^(projeto|trabalho|relatorio|entrega)\b/.test(ficheiroNormalizado)
  ) {
    return doFicheiro;
  }

  return titulo;
}

function extrairTituloDoContexto(antes, depois, fallback) {
  for (const expressao of ROTULOS_TITULO) {
    const resultado = ultimoResultado(expressao, antes);

    if (resultado) {
      const titulo = limparRotulo(resultado[0]);

      if (titulo) {
        return titulo;
      }
    }
  }

  for (const expressao of ROTULOS_TITULO) {
    const resultado = expressao.exec(depois);

    if (resultado) {
      const titulo = limparRotulo(resultado[0]);

      if (titulo) {
        return titulo;
      }
    }
  }

  return fallback || 'Data no documento';
}

/**
 * Nos ficheiros, o título costuma ser mais fiável do que o texto à volta:
 * uma tabela de regras pode falar em "exame" sem que a data seja de um exame.
 */
function classificarCandidato(titulo, contexto) {
  const porTitulo = classificarTipoEvento({ nome: titulo });

  if (porTitulo !== 'outro') {
    return porTitulo;
  }

  return classificarTipoEvento({ nome: titulo, descricao: contexto });
}

function criarSnippet(texto, inicio, fim) {
  const margem = 110;
  const inicioTrecho = Math.max(0, inicio - margem);
  const fimTrecho = Math.min(texto.length, fim + margem);
  let trecho = texto.slice(inicioTrecho, fimTrecho).trim();

  if (inicioTrecho > 0) {
    trecho = `…${trecho}`;
  }

  if (fimTrecho < texto.length) {
    trecho = `${trecho}…`;
  }

  if (trecho.length > LIMITE_SNIPPET) {
    trecho = `${trecho.slice(0, LIMITE_SNIPPET - 1).trimEnd()}…`;
  }

  return trecho;
}

function contextoDaData(texto, indice, comprimento) {
  return texto.slice(
    Math.max(0, indice - 150),
    Math.min(texto.length, indice + comprimento + 170),
  );
}

function candidatoDeData({
  texto,
  indice,
  comprimento,
  dia,
  mes,
  ano,
  anoExplicito,
  inicioSemestre,
  agora,
  nomeFicheiro,
  fuso,
  tipoConfianca,
  dadosSemana = null,
}) {
  if (!dataValida(ano, mes, dia)) {
    return null;
  }

  const contexto = contextoDaData(texto, indice, comprimento);
  const contextoNormalizado = normalizarParaComparacao(contexto);

  if (CONTEXTO_IRRELEVANTE.test(contextoNormalizado)) {
    return null;
  }

  if (!dadosSemana && !PALAVRAS_EVENTO.test(contextoNormalizado)) {
    return null;
  }

  if (dadosSemana && CONTEXTO_SEMANA_IRRELEVANTE.test(contextoNormalizado)) {
    return null;
  }

  const antes = texto.slice(Math.max(0, indice - 190), indice);
  const depois = texto.slice(indice + comprimento, Math.min(texto.length, indice + comprimento + 70));
  const fallback = dadosSemana
    ? `Semana ${dadosSemana}`
    : tituloDoFicheiro(nomeFicheiro) || 'Data no documento';
  const titulo = ajustarTitulo(
    extrairTituloDoContexto(antes, depois, fallback),
    nomeFicheiro,
  );
  const hora = dadosSemana ? { hora: 9, minuto: 0 } : extrairHora(texto, indice, indice + comprimento);
  const data = criarDataNoFuso(
    ano,
    mes,
    dia,
    hora?.hora ?? 23,
    hora?.minuto ?? 59,
    fuso,
  );

  return {
    date: data.toISOString(),
    dateConfidence: tipoConfianca,
    type: classificarCandidato(titulo, contexto),
    title: titulo,
    snippet: criarSnippet(texto, indice, indice + comprimento),
    semana: dadosSemana,
    anoInferido: !anoExplicito,
  };
}

/**
 * Extrai datas e referências a semanas de um bloco de texto (normalmente uma
 * página de PDF ou um slide). Só devolve candidatos com contexto de avaliação,
 * entrega ou prazo; a decisão final é sempre do utilizador.
 */
export function extrairDatasDoTexto(
  texto = '',
  {
    inicioSemestre = null,
    fuso = 'Europe/Lisbon',
    nomeFicheiro = '',
    agora = new Date(),
  } = {},
) {
  const normalizado = normalizarTextoExtraido(texto);
  const candidatos = [];

  RE_DATA_TEXTO.lastIndex = 0;
  let resultado;

  while ((resultado = RE_DATA_TEXTO.exec(normalizado)) !== null) {
    const dia = Number(resultado[1]);
    const mes = numeroDoMes(resultado[2]);
    const anoExplicito = Boolean(resultado[3]);
    const ano = anoExplicito
      ? normalizarAno(resultado[3])
      : inferirAno(mes, inicioSemestre, agora);

    if (!mes || !ano) {
      continue;
    }

    const candidato = candidatoDeData({
      texto: normalizado,
      indice: resultado.index,
      comprimento: resultado[0].length,
      dia,
      mes,
      ano,
      anoExplicito,
      inicioSemestre,
      agora,
      nomeFicheiro,
      fuso,
      tipoConfianca: anoExplicito ? 'exact' : 'unclear',
    });

    if (candidato) {
      candidatos.push(candidato);
    }
  }

  RE_DATA_NUMERICA.lastIndex = 0;

  while ((resultado = RE_DATA_NUMERICA.exec(normalizado)) !== null) {
    const dia = Number(resultado[1]);
    const mes = Number(resultado[3]);
    const ano = normalizarAno(resultado[4]);

    if (!ano) {
      continue;
    }

    const candidato = candidatoDeData({
      texto: normalizado,
      indice: resultado.index,
      comprimento: resultado[0].length,
      dia,
      mes,
      ano,
      anoExplicito: true,
      inicioSemestre,
      agora,
      nomeFicheiro,
      fuso,
      tipoConfianca: 'exact',
    });

    if (candidato) {
      candidatos.push(candidato);
    }
  }

  for (const semana of extrairSemanasDoTexto(normalizado, { inicioSemestre, fuso })) {
    const data = semana.data;
    const candidato = candidatoDeData({
      texto: normalizado,
      indice: semana.indice,
      comprimento: semana.comprimento,
      dia: data.getDate(),
      mes: data.getMonth() + 1,
      ano: data.getFullYear(),
      anoExplicito: true,
      inicioSemestre,
      agora,
      nomeFicheiro,
      fuso,
      tipoConfianca: 'week-based',
      dadosSemana: semana.numero,
    });

    if (candidato) {
      candidatos.push(candidato);
    }
  }

  const vistos = new Set();

  return candidatos
    .filter((candidato) => {
      const chave = `${candidato.date}|${normalizarParaComparacao(candidato.title)}`;

      if (vistos.has(chave)) {
        return false;
      }

      vistos.add(chave);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Remove o prefixo que o Moodle acrescenta aos eventos, por exemplo:
 * "Termina o prazo de 'LAB_03 - Turma PL6'" → "LAB_03 - Turma PL6".
 */
export function extrairTituloDoEvento(nome = '', nomeAtividade = '') {
  const limpo = limparHtml(nomeAtividade || nome);
  const resultado = limpo.match(PREFIXO_PRAZO);
  return (resultado ? resultado[2] : limpo).trim();
}

/**
 * Classifica o evento nas categorias normalizadas do projeto.
 * O tipo da atividade no Moodle tem prioridade sobre as palavras do título.
 */
export function classificarTipoEvento({ nome = '', nomeAtividade = '', modulo = '', descricao = '' } = {}) {
  const texto = normalizarParaComparacao([nome, nomeAtividade, descricao].filter(Boolean).join(' '));

  if (modulo === 'quiz') {
    return 'teste';
  }

  if (/epoca especial|exame|recurso/.test(texto) && modulo !== 'assign') {
    return 'exame';
  }

  if (/teste|frequencia|mini-teste|\bquiz\b/.test(texto)) {
    return 'teste';
  }

  if (modulo === 'assign') {
    return 'entrega';
  }

  if (/entrega|entregar|projeto|trabalho|laboratorio|\blab\b|relatorio|apresentacao|submissao|milestone|prazo/.test(texto)) {
    return 'entrega';
  }

  if (/exame|epoca especial|recurso/.test(texto)) {
    return 'exame';
  }

  return 'outro';
}
