import assert from 'node:assert/strict';
import test from 'node:test';
import { ErroPptx, extrairTextoPptx } from '../../server/extractors/pptx.js';
import { criarZipFicheiro } from '../ajudantes/ficheiros.js';

function xmlSlide(paragrafos) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="x" xmlns:a="y"><p:cSld><p:spTree>' +
    paragrafos
      .map(
        (texto) =>
          `<p:sp><a:p><a:r><a:rPr lang="pt-PT"/><a:t>${texto}</a:t></a:r></a:p></p:sp>`,
      )
      .join('') +
    '</p:spTree></p:cSld></p:sld>'
  );
}

test('extrai texto dos slides pela ordem numérica', () => {
  const ficheiro = criarZipFicheiro([
    ['ppt/slides/slide10.xml', xmlSlide(['Slide dez']), true],
    ['ppt/slides/slide2.xml', xmlSlide(['Entrega do projeto', '18 de dezembro de 2026']), true],
    ['ppt/slides/slide1.xml', xmlSlide(['Avaliação &amp; datas']), true],
    ['ppt/media/imagem.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), false],
  ]);

  const resultado = extrairTextoPptx(ficheiro);

  assert.equal(resultado.tipo, 'pptx');
  assert.deepEqual(
    resultado.paginas.map((pagina) => pagina.numero),
    [1, 2, 10],
  );
  assert.match(resultado.paginas[0].texto, /Avaliação & datas/);
  assert.match(resultado.paginas[1].texto, /18 de dezembro de 2026/);
  assert.match(resultado.texto, /Slide dez/);
});

test('falha com mensagem clara quando não existem slides', () => {
  const ficheiro = criarZipFicheiro([['ppt/presentation.xml', '<p:presentation/>', true]]);

  assert.throws(() => extrairTextoPptx(ficheiro), ErroPptx);
});
