import { inflateRawSync, inflateSync } from 'node:zlib';
import { normalizarTextoExtraido } from './texto.js';

const MAX_OBJETOS = 100_000;
const MAX_PAGINAS = 300;
const MAX_PROFUNDIDADE_PAGINAS = 50;

export class ErroPdf extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroPdf';
  }
}

// ---------------------------------------------------------------------------
// Leitura de objetos PDF
// ---------------------------------------------------------------------------

function ehEspaco(caractere) {
  return (
    caractere === ' ' ||
    caractere === '\n' ||
    caractere === '\r' ||
    caractere === '\t' ||
    caractere === '\f' ||
    caractere === '\0'
  );
}

function saltarEspacos(texto, posicao) {
  let pos = posicao;

  while (pos < texto.length) {
    if (ehEspaco(texto[pos])) {
      pos += 1;
      continue;
    }

    if (texto[pos] === '%') {
      const fim = texto.indexOf('\n', pos);
      pos = fim === -1 ? texto.length : fim + 1;
      continue;
    }

    break;
  }

  return pos;
}

function descodificarNome(nome) {
  return nome.replace(/#([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function lerTextoLiteral(texto, posicao) {
  // posicao aponta para o "(" inicial.
  let pos = posicao + 1;
  let profundidade = 1;
  let resultado = '';

  while (pos < texto.length && profundidade > 0) {
    const caractere = texto[pos];

    if (caractere === '\\') {
      const seguinte = texto[pos + 1];
      const simples = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

      if (seguinte in simples) {
        resultado += simples[seguinte];
        pos += 2;
      } else if (seguinte === '\r' || seguinte === '\n') {
        pos += seguinte === '\r' && texto[pos + 2] === '\n' ? 3 : 2;
      } else if (/[0-7]/.test(seguinte || '')) {
        let octal = '';
        let deslocamento = 1;
        while (deslocamento <= 3 && /[0-7]/.test(texto[pos + deslocamento] || '')) {
          octal += texto[pos + deslocamento];
          deslocamento += 1;
        }
        resultado += String.fromCharCode(Number.parseInt(octal, 8));
        pos += deslocamento;
      } else {
        pos += 2;
      }
      continue;
    }

    if (caractere === '(') {
      profundidade += 1;
      resultado += caractere;
      pos += 1;
      continue;
    }

    if (caractere === ')') {
      profundidade -= 1;
      if (profundidade > 0) {
        resultado += caractere;
      }
      pos += 1;
      continue;
    }

    resultado += caractere;
    pos += 1;
  }

  return { valor: { tipo: 'texto', bytes: resultado }, pos };
}

function lerTextoHexadecimal(texto, posicao) {
  const fim = texto.indexOf('>', posicao + 1);

  if (fim === -1) {
    return { valor: { tipo: 'texto', bytes: '' }, pos: texto.length };
  }

  const hex = texto.slice(posicao + 1, fim).replace(/\s+/g, '');
  const normalizado = hex.length % 2 === 0 ? hex : `${hex}0`;
  let bytes = '';

  for (let indice = 0; indice < normalizado.length; indice += 2) {
    bytes += String.fromCharCode(Number.parseInt(normalizado.slice(indice, indice + 2), 16));
  }

  return { valor: { tipo: 'texto', bytes }, pos: fim + 1 };
}

/**
 * Analisa um valor PDF (dicionário, array, nome, número, referência ou texto).
 * Devolve o valor e a posição seguinte no texto.
 */
function analisarValorPdf(texto, posicao) {
  let pos = saltarEspacos(texto, posicao);

  if (pos >= texto.length) {
    return { valor: null, pos };
  }

  if (texto.startsWith('<<', pos)) {
    pos += 2;
    const dicionario = new Map();

    while (pos < texto.length) {
      pos = saltarEspacos(texto, pos);

      if (texto.startsWith('>>', pos)) {
        pos += 2;
        break;
      }

      if (texto[pos] !== '/') {
        // Dicionário malformado: avança um caractere para não entrar em ciclo.
        pos += 1;
        continue;
      }

      const nome = analisarValorPdf(texto, pos);
      const valor = analisarValorPdf(texto, nome.pos);
      dicionario.set(nome.valor.valor, valor.valor);
      pos = valor.pos;
    }

    return { valor: dicionario, pos };
  }

  if (texto[pos] === '[') {
    pos += 1;
    const lista = [];

    while (pos < texto.length) {
      pos = saltarEspacos(texto, pos);

      if (texto[pos] === ']') {
        pos += 1;
        break;
      }

      const item = analisarValorPdf(texto, pos);
      if (item.pos === pos) {
        pos += 1;
        continue;
      }
      lista.push(item.valor);
      pos = item.pos;
    }

    return { valor: lista, pos };
  }

  if (texto[pos] === '/') {
    let fim = pos + 1;
    while (fim < texto.length && !ehEspaco(texto[fim]) && !'()<>[]{}/%'.includes(texto[fim])) {
      fim += 1;
    }
    return { valor: { tipo: 'nome', valor: descodificarNome(texto.slice(pos + 1, fim)) }, pos: fim };
  }

  if (texto[pos] === '(') {
    return lerTextoLiteral(texto, pos);
  }

  if (texto[pos] === '<') {
    return lerTextoHexadecimal(texto, pos);
  }

  const numero = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(texto.slice(pos, pos + 32));

  if (numero) {
    const primeiro = Number(numero[0]);
    const depoisNumero = pos + numero[0].length;
    const segundo = /^\s+(\d+)\s+R\b/.exec(texto.slice(depoisNumero, depoisNumero + 24));

    if (segundo && Number.isInteger(primeiro)) {
      return {
        valor: { tipo: 'ref', numero: primeiro, geracao: Number(segundo[1]) },
        pos: depoisNumero + segundo[0].length,
      };
    }

    return { valor: primeiro, pos: depoisNumero };
  }

  const palavra = /^[^\s()<>[\]{}/%]+/.exec(texto.slice(pos, pos + 64));

  if (palavra) {
    const valor = palavra[0];
    const posSeguinte = pos + valor.length;

    if (valor === 'true') {
      return { valor: true, pos: posSeguinte };
    }
    if (valor === 'false') {
      return { valor: false, pos: posSeguinte };
    }
    if (valor === 'null') {
      return { valor: null, pos: posSeguinte };
    }

    return { valor: { tipo: 'operador', valor }, pos: posSeguinte };
  }

  return { valor: null, pos: pos + 1 };
}

function nomeDe(valor) {
  return valor?.tipo === 'nome' ? valor.valor : null;
}

function lerCorpoObjeto(texto, buffer, inicioCorpo, indiceFimObjeto) {
  const trecho = texto.slice(inicioCorpo, indiceFimObjeto);
  const marcadorStream = />>\s*stream(\r\n|\n|\r)/.exec(trecho);
  const dictTexto = (marcadorStream ? trecho.slice(0, marcadorStream.index + 2) : trecho).trim();
  const analisado = analisarValorPdf(dictTexto, 0);
  const valor = analisado.valor;
  const dict = valor instanceof Map ? valor : new Map();
  let stream = null;
  let fim = indiceFimObjeto + 'endobj'.length;

  if (marcadorStream) {
    const inicioStream =
      inicioCorpo + marcadorStream.index + marcadorStream[0].length;
    const tamanhoDireto = dict.get('Length');
    let fimStream = -1;

    if (Number.isInteger(tamanhoDireto) && tamanhoDireto >= 0) {
      fimStream = Math.min(inicioStream + tamanhoDireto, texto.length);
    } else {
      fimStream = texto.indexOf('endstream', inicioStream);
      if (fimStream === -1) {
        fimStream = texto.length;
      } else {
        while (fimStream > inicioStream && (texto[fimStream - 1] === '\n' || texto[fimStream - 1] === '\r')) {
          fimStream -= 1;
        }
      }
    }

    stream = buffer.subarray(inicioStream, fimStream);
    const depoisStream = texto.indexOf('endobj', fimStream);
    fim = depoisStream === -1 ? texto.length : depoisStream + 'endobj'.length;
  }

  return { valor, dict, stream, fim };
}

function analisarObjetos(texto, buffer) {
  const objetos = new Map();
  const padrao = /(?:^|[^0-9])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
  let resultado;

  while ((resultado = padrao.exec(texto)) !== null) {
    if (objetos.size >= MAX_OBJETOS) {
      break;
    }

    const numero = Number(resultado[1]);
    const inicioCorpo = resultado.index + resultado[0].length;
    let fimObjeto = texto.indexOf('endobj', inicioCorpo);

    if (fimObjeto === -1) {
      fimObjeto = texto.length;
    }

    const { valor, dict, stream, fim } = lerCorpoObjeto(texto, buffer, inicioCorpo, fimObjeto);

    if (!objetos.has(numero)) {
      objetos.set(numero, { valor, dict, stream });
    }

    padrao.lastIndex = Math.max(fim, inicioCorpo);
  }

  return objetos;
}

function incorporarObjectStreams(objetos, avisos) {
  for (const objeto of [...objetos.values()]) {
    if (nomeDe(objeto.dict.get('Type')) !== 'ObjStm' || !objeto.stream) {
      continue;
    }

    const descodificado = descodificarStream(objeto, avisos);
    if (!descodificado) {
      continue;
    }

    const texto = descodificado.toString('latin1');
    const total = Number(objeto.dict.get('N')) || 0;
    const primeiro = Number(objeto.dict.get('First')) || 0;

    if (total <= 0 || primeiro <= 0) {
      continue;
    }

    const cabecalho = texto.slice(0, primeiro).trim().split(/\s+/).map(Number);
    const posicoes = [];

    for (let indice = 0; indice + 1 < cabecalho.length; indice += 2) {
      posicoes.push({ numero: cabecalho[indice], deslocamento: cabecalho[indice + 1] });
    }

    posicoes.forEach((entrada, indice) => {
      if (!Number.isInteger(entrada.numero) || objetos.has(entrada.numero)) {
        return;
      }

      const fim = posicoes[indice + 1]?.deslocamento ?? texto.length - primeiro;
      const corpo = texto.slice(primeiro + entrada.deslocamento, primeiro + fim);
      const analisado = analisarValorPdf(corpo, 0);

      objetos.set(entrada.numero, {
        valor: analisado.valor,
        dict: analisado.valor instanceof Map ? analisado.valor : new Map(),
        stream: null,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Streams e filtros
// ---------------------------------------------------------------------------

function descodificarStream(objeto, avisos) {
  if (!objeto?.stream) {
    return null;
  }

  const filtro = objeto.dict.get('Filter');
  const filtros = (Array.isArray(filtro) ? filtro : [filtro])
    .map((item) => nomeDe(item))
    .filter(Boolean);

  let dados = objeto.stream;

  for (const nome of filtros) {
    if (nome === 'FlateDecode' || nome === 'Fl') {
      try {
        dados = inflateSync(dados);
      } catch {
        try {
          dados = inflateRawSync(dados);
        } catch {
          avisos.add('Não foi possível descomprimir um bloco do PDF.');
          return null;
        }
      }
      continue;
    }

    if (nome === 'ASCIIHexDecode' || nome === 'AHx') {
      const hex = dados.toString('latin1').split('>')[0].replace(/[^0-9a-fA-F]/g, '');
      const normalizado = hex.length % 2 === 0 ? hex : `${hex}0`;
      dados = Buffer.from(normalizado, 'hex');
      continue;
    }

    avisos.add(`Filtro de PDF não suportado (${nome}); parte do texto pode faltar.`);
    return null;
  }

  return dados;
}

// ---------------------------------------------------------------------------
// Fontes e ToUnicode
// ---------------------------------------------------------------------------

const NOMES_GLIFOS = {
  space: ' ',
  exclam: '!',
  quotedbl: '"',
  numbersign: '#',
  dollar: '$',
  percent: '%',
  ampersand: '&',
  quotesingle: "'",
  parenleft: '(',
  parenright: ')',
  asterisk: '*',
  plus: '+',
  comma: ',',
  hyphen: '-',
  period: '.',
  slash: '/',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  colon: ':',
  semicolon: ';',
  less: '<',
  equal: '=',
  greater: '>',
  question: '?',
  at: '@',
  bracketleft: '[',
  backslash: '\\',
  bracketright: ']',
  asciicircum: '^',
  underscore: '_',
  grave: '`',
  braceleft: '{',
  bar: '|',
  braceright: '}',
  asciitilde: '~',
  agrave: 'à',
  aacute: 'á',
  acircumflex: 'â',
  atilde: 'ã',
  adieresis: 'ä',
  aring: 'å',
  ccedilla: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecircumflex: 'ê',
  edieresis: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icircumflex: 'î',
  idieresis: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocircumflex: 'ô',
  otilde: 'õ',
  odieresis: 'ö',
  ugrave: 'ù',
  uacute: 'ú',
  ucircumflex: 'û',
  udieresis: 'ü',
  yacute: 'ý',
  ydieresis: 'ÿ',
  germandbls: 'ß',
  ae: 'æ',
  oe: 'œ',
  oslash: 'ø',
  AE: 'Æ',
  OE: 'Œ',
  Oslash: 'Ø',
  plusminus: '±',
  multiply: '×',
  divide: '÷',
  degree: '°',
  ordfeminine: 'ª',
  ordmasculine: 'º',
  section: '§',
  paragraph: '¶',
  periodcentered: '·',
  endash: '–',
  emdash: '—',
  quoteleft: '‘',
  quoteright: '’',
  quotedblleft: '“',
  quotedblright: '”',
  bullet: '•',
  ellipsis: '…',
  Euro: '€',
  trademark: '™',
  registered: '®',
  copyright: '©',
};

const CP1252_ALTOS = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function glifoParaUnicode(nome) {
  if (!nome) {
    return '';
  }

  if (NOMES_GLIFOS[nome]) {
    return NOMES_GLIFOS[nome];
  }

  if (nome.length === 1) {
    return nome;
  }

  const uni = /^uni([0-9a-fA-F]{4,6})$/.exec(nome);
  if (uni) {
    return String.fromCodePoint(Number.parseInt(uni[1], 16));
  }

  const u = /^u([0-9a-fA-F]{4,6})$/.exec(nome);
  if (u) {
    return String.fromCodePoint(Number.parseInt(u[1], 16));
  }

  return '';
}

function hexParaUnicode(hex) {
  const normalizado = hex.length % 4 === 0 ? hex : hex.padStart(Math.ceil(hex.length / 4) * 4, '0');
  let resultado = '';

  for (let indice = 0; indice < normalizado.length; indice += 4) {
    resultado += String.fromCharCode(Number.parseInt(normalizado.slice(indice, indice + 4), 16));
  }

  return resultado;
}

function incrementarHex(hex) {
  const codigo = Number.parseInt(hex, 16) + 1;
  return codigo.toString(16).padStart(hex.length, '0');
}

function lerCMap(texto) {
  const mapas = new Map();

  function registar(origem, destino) {
    const tamanho = Math.max(1, origem.length / 2);

    if (!mapas.has(tamanho)) {
      mapas.set(tamanho, new Map());
    }

    mapas.get(tamanho).set(Number.parseInt(origem, 16), destino);
  }

  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      if (par[2]) {
        registar(par[1], hexParaUnicode(par[2]));
      }
    }
  }

  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const entrada of bloco[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g,
    )) {
      const inicio = Number.parseInt(entrada[1], 16);
      const fim = Number.parseInt(entrada[2], 16);

      if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim < inicio || fim - inicio > 65_535) {
        continue;
      }

      if (entrada[4] !== undefined) {
        let destinoHex = entrada[4];

        for (let codigo = inicio; codigo <= fim; codigo += 1) {
          registar(
            codigo.toString(16).padStart(entrada[1].length, '0'),
            hexParaUnicode(destinoHex),
          );
          destinoHex = incrementarHex(destinoHex);
        }
      } else {
        const destinos = [...(entrada[5] || '').matchAll(/<([0-9a-fA-F]+)>/g)].map((item) => item[1]);

        for (let indice = 0; indice <= fim - inicio && indice < destinos.length; indice += 1) {
          registar(
            (inicio + indice).toString(16).padStart(entrada[1].length, '0'),
            hexParaUnicode(destinos[indice]),
          );
        }
      }
    }
  }

  return mapas;
}

function lerDiferencas(dict) {
  const mapa = new Map();
  const encoding = dict.get('Encoding');

  if (!(encoding instanceof Map)) {
    return mapa;
  }

  const diferencas = encoding.get('Differences');

  if (!Array.isArray(diferencas)) {
    return mapa;
  }

  let codigo = 0;

  for (const item of diferencas) {
    if (typeof item === 'number') {
      codigo = item;
    } else if (item?.tipo === 'nome') {
      mapa.set(codigo, glifoParaUnicode(item.valor));
      codigo += 1;
    }
  }

  return mapa;
}

function byteParaTexto(codigo) {
  if (codigo < 32 && codigo !== 9 && codigo !== 10 && codigo !== 13) {
    return '';
  }

  return CP1252_ALTOS[codigo] ?? String.fromCharCode(codigo);
}

function criarDecodificadorFonte(objeto, objetos, avisos) {
  const dict = objeto?.dict instanceof Map ? objeto.dict : null;

  if (!dict) {
    return {
      descodificar: (bytes) => bytes,
      larguraEm: (bytes) => bytes.length * 0.5,
    };
  }

  const subtipo = nomeDe(dict.get('Subtype'));
  const ehType0 = subtipo === 'Type0';
  const tamanho = ehType0 ? 2 : 1;
  let mapas = null;

  const referenciaToUnicode = dict.get('ToUnicode');
  if (referenciaToUnicode?.tipo === 'ref') {
    const cmap = objetos.get(referenciaToUnicode.numero);
    const descodificado = cmap ? descodificarStream(cmap, avisos) : null;

    if (descodificado) {
      mapas = lerCMap(descodificado.toString('latin1'));
    }
  }

  const diferencas = ehType0 ? new Map() : lerDiferencas(dict);
  const mapaPreferido = mapas?.get(tamanho) ?? null;
  const mapaUnico = mapas?.get(1) ?? null;
  const larguras = obterLarguras(dict, objetos, ehType0);

  function larguraEm(bytes) {
    let total = 0;

    for (let indice = 0; indice < bytes.length; indice += tamanho) {
      const codigo =
        tamanho === 2
          ? (bytes.charCodeAt(indice) << 8) | bytes.charCodeAt(indice + 1)
          : bytes.charCodeAt(indice);

      total += larguras(codigo) / 1000;
    }

    return total;
  }

  function descodificar(bytes) {
    let resultado = '';

    for (let indice = 0; indice < bytes.length; indice += tamanho) {
      if (tamanho === 2 && indice + 1 >= bytes.length) {
        break;
      }

      const codigo =
        tamanho === 2
          ? (bytes.charCodeAt(indice) << 8) | bytes.charCodeAt(indice + 1)
          : bytes.charCodeAt(indice);

      if (mapaPreferido?.has(codigo)) {
        resultado += mapaPreferido.get(codigo);
        continue;
      }

      if (mapaUnico?.has(codigo)) {
        resultado += mapaUnico.get(codigo);
        continue;
      }

      if (tamanho === 2) {
        resultado += codigo === 0 ? '' : String.fromCharCode(codigo);
        continue;
      }

      resultado += diferencas.get(codigo) ?? byteParaTexto(codigo);
    }

    return resultado;
  }

  return { descodificar, larguraEm };
}

/**
 * Larguras dos glifos em milésimos de em. Usadas para distinguir a continuação
 * de uma palavra (avanço igual à largura do texto) de um espaço real (avanço
 * maior), mesmo quando o PDF não inclui o caractere de espaço.
 */
function obterLarguras(dict, objetos, ehType0) {
  if (!ehType0) {
    const valores = resolverValor(dict.get('Widths'), objetos);
    const primeiro = Number(dict.get('FirstChar')) || 0;

    return (codigo) => {
      const largura = Array.isArray(valores) ? Number(valores[codigo - primeiro]) : NaN;
      return Number.isFinite(largura) ? largura : 500;
    };
  }

  const descendentes = dict.get('DescendantFonts');
  const referencia = Array.isArray(descendentes) ? descendentes[0] : descendentes;
  const descendente = resolverDict(referencia, objetos);
  const predefinida = Number(descendente?.get('DW')) || 1000;
  const lista = resolverValor(descendente?.get('W'), objetos);
  const intervalos = [];

  if (Array.isArray(lista)) {
    let indice = 0;

    while (indice < lista.length) {
      const inicio = Number(lista[indice]);

      if (Array.isArray(lista[indice + 1])) {
        intervalos.push({ inicio, fim: inicio, larguras: lista[indice + 1].map(Number) });
        indice += 2;
        continue;
      }

      const fim = Number(lista[indice + 1]);
      const largura = Number(lista[indice + 2]);
      intervalos.push({ inicio, fim: Number.isFinite(fim) ? fim : inicio, largura });
      indice += 3;
    }
  }

  return (codigo) => {
    for (const intervalo of intervalos) {
      if (codigo < intervalo.inicio || codigo > intervalo.fim) {
        continue;
      }

      if (intervalo.larguras) {
        const largura = intervalo.larguras[codigo - intervalo.inicio];
        return Number.isFinite(largura) ? largura : predefinida;
      }

      return Number.isFinite(intervalo.largura) ? intervalo.largura : predefinida;
    }

    return predefinida;
  };
}

function obterFontes(recursos, objetos, avisos) {
  const fontes = new Map();
  const dicionarioFontes = recursos?.get('Font');

  if (!(dicionarioFontes instanceof Map)) {
    return fontes;
  }

  for (const [nome, referencia] of dicionarioFontes) {
    const objeto = referencia?.tipo === 'ref' ? objetos.get(referencia.numero) : null;

    if (objeto) {
      fontes.set(nome, criarDecodificadorFonte(objeto, objetos, avisos));
    }
  }

  return fontes;
}

// ---------------------------------------------------------------------------
// Páginas e recursos
// ---------------------------------------------------------------------------

function encontrarPaginas(objetos) {
  let catalogo = null;

  for (const objeto of objetos.values()) {
    if (nomeDe(objeto.dict.get('Type')) === 'Catalog') {
      catalogo = objeto;
      break;
    }
  }

  const paginas = [];
  const visitados = new Set();

  function visitar(referencia, profundidade) {
    if (!referencia || referencia.tipo !== 'ref' || profundidade > MAX_PROFUNDIDADE_PAGINAS) {
      return;
    }

    if (visitados.has(referencia.numero)) {
      return;
    }
    visitados.add(referencia.numero);

    const objeto = objetos.get(referencia.numero);

    if (!objeto) {
      return;
    }

    const tipo = nomeDe(objeto.dict.get('Type'));

    if (tipo === 'Page') {
      paginas.push({ dict: objeto.dict, objeto });
      return;
    }

    if (tipo === 'Pages' || objeto.dict.has('Kids')) {
      for (const filho of objeto.dict.get('Kids') || []) {
        visitar(filho, profundidade + 1);
      }
    }
  }

  visitar(catalogo?.dict.get('Pages'), 0);

  if (paginas.length === 0) {
    // Alternativa para PDFs com a árvore de páginas comprimida em object streams
    // ou com uma estrutura não convencional.
    const soltas = [...objetos.entries()]
      .filter(([, objeto]) => nomeDe(objeto.dict.get('Type')) === 'Page')
      .sort((a, b) => a[0] - b[0])
      .map(([, objeto]) => ({ dict: objeto.dict, objeto }));

    paginas.push(...soltas);
  }

  return paginas;
}

function resolverDict(valor, objetos) {
  if (valor?.tipo === 'ref') {
    return objetos.get(valor.numero)?.dict ?? null;
  }

  return valor instanceof Map ? valor : null;
}

function resolverValor(valor, objetos) {
  if (valor?.tipo === 'ref') {
    return objetos.get(valor.numero)?.valor ?? null;
  }

  return valor;
}

function obterRecursos(dictPagina, objetos) {
  let dict = dictPagina;

  for (let profundidade = 0; dict && profundidade < MAX_PROFUNDIDADE_PAGINAS; profundidade += 1) {
    const recursos = resolverDict(dict.get('Resources'), objetos);

    if (recursos) {
      return recursos;
    }

    dict = resolverDict(dict.get('Parent'), objetos);
  }

  return null;
}

function obterConteudos(dictPagina, objetos, avisos) {
  const conteudo = dictPagina.get('Contents');
  const referencias = [];

  if (conteudo?.tipo === 'ref') {
    referencias.push(conteudo);
  } else if (Array.isArray(conteudo)) {
    for (const item of conteudo) {
      if (item?.tipo === 'ref') {
        referencias.push(item);
      }
    }
  }

  const partes = [];

  for (const referencia of referencias) {
    const objeto = objetos.get(referencia.numero);
    const dados = objeto ? descodificarStream(objeto, avisos) : null;

    if (dados) {
      partes.push(dados.toString('latin1'));
    }
  }

  return partes;
}

// ---------------------------------------------------------------------------
// Operadores de texto
// ---------------------------------------------------------------------------

function proximoToken(texto, posicao) {
  const pos = saltarEspacos(texto, posicao);

  if (pos >= texto.length) {
    return { token: null, pos };
  }

  const caractere = texto[pos];

  if (caractere === '(' || caractere === '<' || caractere === '[' || caractere === '/') {
    const analisado = analisarValorPdf(texto, pos);
    return { token: { tipo: 'valor', valor: analisado.valor }, pos: analisado.pos };
  }

  if (/[0-9+\-.]/.test(caractere)) {
    const analisado = analisarValorPdf(texto, pos);
    return { token: { tipo: 'valor', valor: analisado.valor }, pos: analisado.pos };
  }

  const palavra = /^[^\s()<>[\]{}/%]+/.exec(texto.slice(pos, pos + 64));

  if (palavra) {
    return { token: { tipo: 'operador', valor: palavra[0] }, pos: pos + palavra[0].length };
  }

  return { token: null, pos: pos + 1 };
}

function extrairTextoDoConteudo(conteudo, fontes) {
  let pos = 0;
  let operandos = [];
  let fonte = null;
  let tamanhoFonte = 0;
  let larguraAcumulada = 0;
  let saida = '';
  let ultimaX = null;
  let ultimaY = null;
  let quebraPendente = false;

  function novaEntrada() {
    if (saida && !saida.endsWith('\n')) {
      saida += '\n';
    }
    larguraAcumulada = 0;
    quebraPendente = false;
  }

  function garantirLinha() {
    if (quebraPendente) {
      novaEntrada();
    }
  }

  function mostrar(bytes) {
    if (!bytes) {
      return;
    }

    garantirLinha();
    const descodificado = fonte ? fonte.descodificar(bytes) : bytes;
    const texto = descodificado.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    larguraAcumulada += fonte ? fonte.larguraEm(bytes) : bytes.length * 0.5;

    if (texto) {
      saida += texto;
    }
  }

  while (pos < conteudo.length) {
    const resultado = proximoToken(conteudo, pos);

    if (!resultado.token) {
      pos = resultado.pos === pos ? pos + 1 : resultado.pos;
      continue;
    }

    pos = resultado.pos;
    const token = resultado.token;

    if (token.tipo !== 'operador') {
      operandos.push(token.valor);
      continue;
    }

    const operador = token.valor;

    if (operador === 'Tf') {
      garantirLinha();
      const nome = operandos[0]?.tipo === 'nome' ? operandos[0].valor : null;
      fonte = nome ? fontes.get(nome) || null : null;
      tamanhoFonte = typeof operandos[1] === 'number' ? Math.abs(operandos[1]) : 0;
      larguraAcumulada = 0;
    } else if (operador === 'Tj' || operador === "'" || operador === '"') {
      if (operador !== 'Tj') {
        novaEntrada();
      }
      const alvo = operandos.at(-1);
      if (alvo?.tipo === 'texto') {
        mostrar(alvo.bytes);
      }
    } else if (operador === 'TJ') {
      const lista = operandos.at(-1);

      if (Array.isArray(lista)) {
        for (const item of lista) {
          if (item?.tipo === 'texto') {
            mostrar(item.bytes);
          } else if (typeof item === 'number') {
            larguraAcumulada += -item / 1000;

            if (item < -80 && saida && !/\s$/.test(saida)) {
              saida += ' ';
            }
          }
        }
      }
    } else if (operador === 'Td' || operador === 'TD') {
      garantirLinha();
      const deslocamentoY = typeof operandos[1] === 'number' ? operandos[1] : 0;
      const deslocamentoX = typeof operandos[0] === 'number' ? operandos[0] : 0;
      const limiteY = Math.max(0.5, tamanhoFonte * 0.5);

      if (Math.abs(deslocamentoY) > limiteY) {
        novaEntrada();
      } else if (tamanhoFonte > 0) {
        // Um avanço horizontal claramente maior do que a largura do texto já
        // desenhado corresponde a um espaço que o PDF não codificou.
        const espacoEm = deslocamentoX / tamanhoFonte - larguraAcumulada;

        if (espacoEm > 0.16 && saida && !/\s$/.test(saida)) {
          saida += ' ';
        }

        larguraAcumulada = 0;
      }
    } else if (operador === 'T*') {
      novaEntrada();
    } else if (operador === 'Tm') {
      const x = typeof operandos[4] === 'number' ? operandos[4] : null;
      const y = typeof operandos[5] === 'number' ? operandos[5] : null;
      // Fragmentos da mesma linha podem ter pequenas diferenças de base
      // (células de tabela, expoentes); meia linha de texto é o limite seguro.
      const limiteY = Math.max(0.5, tamanhoFonte * 0.5);
      const mesmaLinha =
        ultimaY !== null && y !== null && Math.abs(y - ultimaY) <= limiteY;

      if (mesmaLinha) {
        // Alguns geradores (LaTeX, Word) continuam a mesma linha com uma nova
        // matriz de texto; o espaço existe apenas no posicionamento.
        const baseX = quebraPendente ? ultimaX : null;

        if (baseX !== null && x !== null && tamanhoFonte > 0) {
          const espacoEm =
            x / tamanhoFonte - baseX / tamanhoFonte - larguraAcumulada;

          if (espacoEm > 0.16 && saida && !/\s$/.test(saida)) {
            saida += ' ';
          }
        } else if (quebraPendente && saida && !/\s$/.test(saida)) {
          saida += ' ';
        }
      } else if (ultimaY !== null || quebraPendente) {
        novaEntrada();
      }

      quebraPendente = false;

      if (x !== null) {
        ultimaX = x;
      }

      if (y !== null) {
        ultimaY = y;
      }

      larguraAcumulada = 0;
    } else if (operador === 'BT') {
      ultimaX = null;
      ultimaY = null;
      larguraAcumulada = 0;
    } else if (operador === 'ET') {
      quebraPendente = true;
      larguraAcumulada = 0;
    }

    operandos = [];
  }

  return saida;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Extrai texto de um PDF, página a página, sem dependências externas.
 *
 * Cobre o caso comum dos documentos das cadeiras (PDF 1.4+ gerado por Word,
 * PowerPoint, LaTeX ou LibreOffice): objetos, object streams, FlateDecode,
 * fontes simples e Type0 com mapa ToUnicode. PDFs encriptados ou digitalizados
 * (imagem sem OCR) devolvem texto vazio com um aviso.
 */
export function extrairTextoPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    throw new ErroPdf('Ficheiro PDF demasiado pequeno ou inválido.');
  }

  const texto = buffer.toString('latin1');

  if (!texto.includes('%PDF-')) {
    throw new ErroPdf('O ficheiro não parece ser um PDF.');
  }

  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(texto)) {
    throw new ErroPdf('PDF protegido por palavra-passe; não é possível extrair texto.');
  }

  const avisos = new Set();
  const objetos = analisarObjetos(texto, buffer);
  incorporarObjectStreams(objetos, avisos);

  const paginasEncontradas = encontrarPaginas(objetos);

  if (paginasEncontradas.length === 0) {
    throw new ErroPdf('Não foi possível identificar as páginas do PDF.');
  }

  const paginas = [];
  let semTexto = 0;

  for (const [indice, pagina] of paginasEncontradas.slice(0, MAX_PAGINAS).entries()) {
    const recursos = obterRecursos(pagina.dict, objetos);
    const fontes = obterFontes(recursos, objetos, avisos);
    const conteudos = obterConteudos(pagina.dict, objetos, avisos);
    const textoPagina = normalizarTextoExtraido(
      conteudos.map((conteudo) => extrairTextoDoConteudo(conteudo, fontes)).join('\n'),
    );

    if (!textoPagina) {
      semTexto += 1;
    }

    paginas.push({ numero: indice + 1, texto: textoPagina });
  }

  if (paginasEncontradas.length > MAX_PAGINAS) {
    avisos.add(`PDF com mais de ${MAX_PAGINAS} páginas; só as primeiras foram analisadas.`);
  }

  if (semTexto === paginas.length && paginas.length > 0) {
    avisos.add('Nenhum texto extraível: o PDF pode ser digitalizado (imagem) ou usar fontes sem mapa Unicode.');
  } else if (semTexto > 0) {
    avisos.add(`${semTexto} página(s) sem texto extraível (provavelmente digitalizadas).`);
  }

  return {
    tipo: 'pdf',
    paginas,
    texto: paginas.map((pagina) => pagina.texto).filter(Boolean).join('\n\n'),
    avisos: [...avisos],
  };
}
