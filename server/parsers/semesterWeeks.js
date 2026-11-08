import { obterConfigSemestre } from '../config.js';

// As datas do semestre são construídas num fuso horário explícito para que
// "semana N" dê o mesmo dia no servidor e no browser, mesmo com horário de verão.
const FORMATADORES = new Map();

function formatadorDoFuso(fuso) {
  if (!FORMATADORES.has(fuso)) {
    FORMATADORES.set(
      fuso,
      new Intl.DateTimeFormat('en-US', {
        timeZone: fuso,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }

  return FORMATADORES.get(fuso);
}

/**
 * Valida um fuso IANA. Um valor inválido não deve impedir o dashboard de abrir:
 * nesse caso usa-se o fuso de Portugal continental.
 */
export function normalizarFuso(fuso = 'Europe/Lisbon') {
  const candidato = String(fuso || 'Europe/Lisbon');

  try {
    formatadorDoFuso(candidato).format(new Date());
    return candidato;
  } catch {
    return 'Europe/Lisbon';
  }
}

function partesNoFuso(data, fuso) {
  const partes = formatadorDoFuso(fuso).formatToParts(data);
  const valores = {};

  for (const parte of partes) {
    if (parte.type !== 'literal') {
      valores[parte.type] = Number(parte.value);
    }
  }

  return valores;
}

/**
 * Cria um instante a partir de uma data civil num fuso horário. É necessário
 * repetir o cálculo porque a diferença para UTC muda nas transições de hora.
 */
export function criarDataNoFuso(
  ano,
  mes,
  dia,
  hora = 0,
  minuto = 0,
  fuso = 'Europe/Lisbon',
) {
  const fusoValido = normalizarFuso(fuso);
  const alvoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, 0);
  let instante = alvoUtc;

  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const partes = partesNoFuso(new Date(instante), fusoValido);
    const comoUtc = Date.UTC(
      partes.year,
      partes.month - 1,
      partes.day,
      partes.hour,
      partes.minute,
      partes.second,
    );
    instante = alvoUtc - (comoUtc - instante);
  }

  return new Date(instante);
}

function partesDataIso(valor) {
  const resultado = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || '').trim());

  if (!resultado) {
    return null;
  }

  const ano = Number(resultado[1]);
  const mes = Number(resultado[2]);
  const dia = Number(resultado[3]);
  const verificacao = new Date(Date.UTC(ano, mes - 1, dia));

  if (
    verificacao.getUTCFullYear() !== ano ||
    verificacao.getUTCMonth() !== mes - 1 ||
    verificacao.getUTCDate() !== dia
  ) {
    return null;
  }

  return { ano, mes, dia };
}

/**
 * Converte "semana N" numa data. A semana 1 começa em `SEMESTER_START`; as
 * seguintes avançam sete dias. A hora é 09:00 local para não cair no dia
 * anterior noutros fusos.
 */
export function dataDaSemana(numero, { inicioSemestre, fuso } = {}) {
  const semana = Number(numero);

  if (!Number.isInteger(semana) || semana < 1 || semana > 60) {
    return null;
  }

  const config = obterConfigSemestre();
  const inicio = partesDataIso(inicioSemestre || config.inicio);

  if (!inicio) {
    return null;
  }

  const deslocamento = (semana - 1) * 7;
  const primeiroDia = new Date(Date.UTC(inicio.ano, inicio.mes - 1, inicio.dia + deslocamento));

  return criarDataNoFuso(
    primeiroDia.getUTCFullYear(),
    primeiroDia.getUTCMonth() + 1,
    primeiroDia.getUTCDate(),
    9,
    0,
    fuso || config.fuso,
  );
}

/**
 * Encontra referências a "semana N" no texto. A validação de contexto (por
 * exemplo, ignorar "horas por semana") fica a cargo do parser de datas.
 */
export function extrairSemanasDoTexto(texto = '', { inicioSemestre, fuso } = {}) {
  const expressao = /\bsemana\s+(?:n[.º°o]?\s*)?(\d{1,2})\b/giu;
  const resultados = [];
  let resultado;

  while ((resultado = expressao.exec(String(texto))) !== null) {
    const numero = Number(resultado[1]);
    const data = dataDaSemana(numero, { inicioSemestre, fuso });

    if (!data) {
      continue;
    }

    resultados.push({
      numero,
      data,
      indice: resultado.index,
      comprimento: resultado[0].length,
      texto: resultado[0],
    });
  }

  return resultados;
}
