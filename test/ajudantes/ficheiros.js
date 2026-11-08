import { deflateRawSync, deflateSync } from 'node:zlib';

// CRC32 só é necessário para ferramentas externas; o leitor do projeto não o usa.
const TABELA_CRC = Array.from({ length: 256 }, (_, indice) => {
  let valor = indice;
  for (let passo = 0; passo < 8; passo += 1) {
    valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
  }
  return valor >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = TABELA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Cria um ZIP mínimo em memória para os testes dos extractores. Suporta
 * entradas sem compressão e com deflate, tal como os PPTX reais.
 */
export function criarZipFicheiro(entradas) {
  const locais = [];
  const diretorio = [];
  let deslocamento = 0;

  for (const [nome, conteudoBruto, comprimir] of entradas) {
    const conteudo = Buffer.isBuffer(conteudoBruto)
      ? conteudoBruto
      : Buffer.from(conteudoBruto, 'utf8');
    const dados = comprimir ? deflateRawSync(conteudo) : conteudo;
    const metodo = comprimir ? 8 : 0;
    const nomeBuffer = Buffer.from(nome, 'utf8');
    const crc = crc32(conteudo);

    const cabecalhoLocal = Buffer.alloc(30);
    cabecalhoLocal.writeUInt32LE(0x04034b50, 0);
    cabecalhoLocal.writeUInt16LE(20, 4);
    cabecalhoLocal.writeUInt16LE(0, 6);
    cabecalhoLocal.writeUInt16LE(metodo, 8);
    cabecalhoLocal.writeUInt16LE(0, 10);
    cabecalhoLocal.writeUInt16LE(0, 12);
    cabecalhoLocal.writeUInt32LE(crc, 14);
    cabecalhoLocal.writeUInt32LE(dados.length, 18);
    cabecalhoLocal.writeUInt32LE(conteudo.length, 22);
    cabecalhoLocal.writeUInt16LE(nomeBuffer.length, 26);
    cabecalhoLocal.writeUInt16LE(0, 28);

    const cabecalhoCentral = Buffer.alloc(46);
    cabecalhoCentral.writeUInt32LE(0x02014b50, 0);
    cabecalhoCentral.writeUInt16LE(20, 4);
    cabecalhoCentral.writeUInt16LE(20, 6);
    cabecalhoCentral.writeUInt16LE(0, 8);
    cabecalhoCentral.writeUInt16LE(metodo, 10);
    cabecalhoCentral.writeUInt16LE(0, 12);
    cabecalhoCentral.writeUInt16LE(0, 14);
    cabecalhoCentral.writeUInt32LE(crc, 16);
    cabecalhoCentral.writeUInt32LE(dados.length, 20);
    cabecalhoCentral.writeUInt32LE(conteudo.length, 24);
    cabecalhoCentral.writeUInt16LE(nomeBuffer.length, 28);
    cabecalhoCentral.writeUInt32LE(deslocamento, 42);

    locais.push(cabecalhoLocal, nomeBuffer, dados);
    diretorio.push(cabecalhoCentral, nomeBuffer);
    deslocamento += cabecalhoLocal.length + nomeBuffer.length + dados.length;
  }

  const corpo = Buffer.concat(locais);
  const indiceDiretorio = corpo.length;
  const diretorioBuffer = Buffer.concat(diretorio);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(diretorioBuffer.length, 12);
  eocd.writeUInt32LE(indiceDiretorio, 16);

  return Buffer.concat([corpo, diretorioBuffer, eocd]);
}

/**
 * Constrói um PDF mínimo com uma página e o conteúdo indicado. Evita fixtures
 * binárias versionadas e permite testar fluxos comprimidos e fontes Type0.
 */
export function criarPdfFicheiro({
  conteudo,
  comprimir = false,
  fonte = 'simples',
  cmap = null,
}) {
  const objetos = [];
  const adicionar = (numero, corpo) => {
    objetos[numero] = corpo;
  };

  const conteudoBuffer = Buffer.from(conteudo, 'latin1');
  const dados = comprimir ? deflateSync(conteudoBuffer) : conteudoBuffer;

  const dicionarioFonte =
    fonte === 'type0'
      ? '<< /Type /Font /Subtype /Type0 /BaseFont /Teste /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'
      : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  adicionar(1, '<< /Type /Catalog /Pages 2 0 R >>');
  adicionar(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  adicionar(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  );
  adicionar(
    4,
    `<< /Length ${dados.length}${comprimir ? ' /Filter /FlateDecode' : ''} >>\nstream\n` +
      `${dados.toString('latin1')}\nendstream`,
  );
  adicionar(5, dicionarioFonte);

  if (fonte === 'type0') {
    adicionar(
      6,
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Teste ' +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>',
    );
    adicionar(
      7,
      `<< /Length ${Buffer.byteLength(cmap, 'latin1')} >>\nstream\n${cmap}\nendstream`,
    );
  }

  const partes = ['%PDF-1.4\n'];

  for (let numero = 1; numero < objetos.length; numero += 1) {
    if (objetos[numero]) {
      partes.push(`${numero} 0 obj\n${objetos[numero]}\nendobj\n`);
    }
  }

  partes.push('trailer\n<< /Root 1 0 R >>\n%%EOF\n');
  return Buffer.from(partes.join(''), 'latin1');
}
