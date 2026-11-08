import { inflateRawSync } from 'node:zlib';

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_DIRETORIO = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;
const TAMANHO_MAXIMO_EOCD = 65_557;
const MAX_ENTRADAS = 5_000;
const MAX_BYTES_DESCOMPRIMIDOS = 200 * 1024 * 1024;

export class ErroZip extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroZip';
  }
}

function encontrarDiretorioCentral(buffer) {
  const limite = Math.max(0, buffer.length - TAMANHO_MAXIMO_EOCD);

  for (let posicao = buffer.length - 22; posicao >= limite; posicao -= 1) {
    if (buffer.readUInt32LE(posicao) === ASSINATURA_EOCD) {
      return posicao;
    }
  }

  return -1;
}

/**
 * Leitor mínimo de ficheiros ZIP (usado por PPTX e, no futuro, DOCX).
 *
 * Implementado com `node:zlib` para evitar uma dependência externa. Só suporta
 * o subconjunto necessário: entradas sem encriptação, métodos "stored" e
 * "deflate". ZIP64 e entradas encriptadas são rejeitados com erro claro.
 */
export function lerZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new ErroZip('Ficheiro ZIP demasiado pequeno ou inválido.');
  }

  const posicaoEocd = encontrarDiretorioCentral(buffer);

  if (posicaoEocd === -1) {
    throw new ErroZip('Não foi encontrado o diretório central do ZIP.');
  }

  const totalEntradas = buffer.readUInt16LE(posicaoEocd + 10);
  const inicioDiretorio = buffer.readUInt32LE(posicaoEocd + 16);

  if (inicioDiretorio === 0xffffffff || totalEntradas === 0xffff) {
    throw new ErroZip('ZIP64 não é suportado.');
  }

  if (totalEntradas > MAX_ENTRADAS) {
    throw new ErroZip(`ZIP com demasiadas entradas (${totalEntradas}).`);
  }

  const entradas = new Map();
  let posicao = inicioDiretorio;
  let bytesDescomprimidos = 0;

  for (let indice = 0; indice < totalEntradas; indice += 1) {
    if (posicao + 46 > buffer.length || buffer.readUInt32LE(posicao) !== ASSINATURA_DIRETORIO) {
      throw new ErroZip('Diretório central do ZIP corrompido.');
    }

    const metodo = buffer.readUInt16LE(posicao + 10);
    const tamanhoComprimido = buffer.readUInt32LE(posicao + 20);
    const tamanhoOriginal = buffer.readUInt32LE(posicao + 24);
    const tamanhoNome = buffer.readUInt16LE(posicao + 28);
    const tamanhoExtra = buffer.readUInt16LE(posicao + 30);
    const tamanhoComentario = buffer.readUInt16LE(posicao + 32);
    const deslocamentoLocal = buffer.readUInt32LE(posicao + 42);
    const nome = buffer.toString('utf8', posicao + 46, posicao + 46 + tamanhoNome);

    if (tamanhoOriginal === 0xffffffff || deslocamentoLocal === 0xffffffff) {
      throw new ErroZip('ZIP64 não é suportado.');
    }

    bytesDescomprimidos += tamanhoOriginal;

    if (bytesDescomprimidos > MAX_BYTES_DESCOMPRIMIDOS) {
      throw new ErroZip('ZIP demasiado grande depois de descomprimido.');
    }

    if (nome && !nome.endsWith('/')) {
      entradas.set(nome, {
        metodo,
        tamanhoComprimido,
        tamanhoOriginal,
        deslocamentoLocal,
      });
    }

    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  function ler(nome) {
    const entrada = entradas.get(nome);

    if (!entrada) {
      throw new ErroZip(`Entrada "${nome}" não existe no ZIP.`);
    }

    const local = entrada.deslocamentoLocal;

    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== ASSINATURA_LOCAL) {
      throw new ErroZip(`Cabeçalho local inválido para "${nome}".`);
    }

    const sinalizadores = buffer.readUInt16LE(local + 6);

    if ((sinalizadores & 0x1) === 0x1) {
      throw new ErroZip(`A entrada "${nome}" está encriptada.`);
    }

    const inicioDados =
      local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const dados = buffer.subarray(inicioDados, inicioDados + entrada.tamanhoComprimido);

    if (entrada.metodo === 0) {
      return dados;
    }

    if (entrada.metodo === 8) {
      return inflateRawSync(dados, { maxOutputLength: entrada.tamanhoOriginal || undefined });
    }

    throw new ErroZip(`Método de compressão ${entrada.metodo} não suportado em "${nome}".`);
  }

  return {
    nomes() {
      return [...entradas.keys()];
    },
    tem(nome) {
      return entradas.has(nome);
    },
    ler,
  };
}
