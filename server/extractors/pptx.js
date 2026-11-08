import { descodificarEntidades, normalizarTextoExtraido } from './texto.js';
import { lerZip } from './zip.js';

const PADRAO_SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;

export class ErroPptx extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroPptx';
  }
}

/**
 * Extrai o texto de cada slide de um PPTX. O texto é devolvido por slide para
 * que cada data possa ser localizada ("slide 12") e ordenado pelo número real
 * do slide (e não pela ordem alfabética dos ficheiros XML).
 */
export function extrairTextoPptx(buffer) {
  let zip;

  try {
    zip = lerZip(buffer);
  } catch (erro) {
    throw new ErroPptx(`PPTX inválido: ${erro.message}`);
  }

  const slides = zip
    .nomes()
    .map((nome) => ({ nome, numero: Number(nome.match(PADRAO_SLIDE)?.[1]) }))
    .filter((slide) => Number.isInteger(slide.numero))
    .sort((a, b) => a.numero - b.numero);

  if (slides.length === 0) {
    throw new ErroPptx('O ficheiro não contém slides reconhecíveis.');
  }

  const paginas = slides.map((slide) => ({
    numero: slide.numero,
    texto: normalizarTextoExtraido(extrairTextoDoXml(zip.ler(slide.nome).toString('utf8'))),
  }));

  return {
    tipo: 'pptx',
    paginas,
    texto: paginas
      .map((pagina) => pagina.texto)
      .filter(Boolean)
      .join('\n\n'),
  };
}

function extrairTextoDoXml(xml) {
  const comQuebras = xml
    .replace(/<a:br\b[^>]*\/>/g, '\n')
    .replace(/<\/a:p>/g, '\n');

  // Os runs de texto (`<a:t>`) são o único conteúdo relevante; todas as tags
  // restantes (formatação, gráficos) são descartadas.
  const semTags = comQuebras.replace(/<[^>]*>/g, '');

  return descodificarEntidades(semTags);
}
