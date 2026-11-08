import assert from 'node:assert/strict';
import test from 'node:test';
import { ErroPdf, extrairTextoPdf } from '../../server/extractors/pdf.js';
import { criarPdfFicheiro } from '../ajudantes/ficheiros.js';

test('extrai texto de um PDF simples', () => {
  const pdf = criarPdfFicheiro({
    conteudo:
      'BT /F1 12 Tf 72 720 Td (Entrega do projeto: 18 de dezembro de 2026) Tj ET',
  });

  const resultado = extrairTextoPdf(pdf);

  assert.equal(resultado.paginas.length, 1);
  assert.equal(resultado.paginas[0].texto, 'Entrega do projeto: 18 de dezembro de 2026');
  assert.equal(resultado.avisos.length, 0);
});

test('descomprime o conteúdo com FlateDecode', () => {
  const pdf = criarPdfFicheiro({
    conteudo: 'BT /F1 10 Tf 72 700 Td (Exame: 15 de janeiro de 2027) Tj ET',
    comprimir: true,
  });

  const resultado = extrairTextoPdf(pdf);

  assert.match(resultado.texto, /Exame: 15 de janeiro de 2027/);
});

test('descodifica fontes Type0 através do mapa ToUnicode', () => {
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '3 beginbfchar',
    '<0001> <0045>',
    '<0002> <006E>',
    '<0003> <0020>',
    'endbfchar',
    '1 beginbfrange',
    '<0010> <0012> <0030>',
    'endbfrange',
    'endcmap',
    'end end',
  ].join('\n');

  const pdf = criarPdfFicheiro({
    fonte: 'type0',
    cmap,
    conteudo: 'BT /F1 12 Tf 72 720 Td <000100020003001000110012> Tj ET',
  });

  const resultado = extrairTextoPdf(pdf);

  assert.match(resultado.texto, /En 012/);
});

test('rejeita PDFs encriptados e ficheiros que não são PDF', () => {
  const encriptado = Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF\n',
    'latin1',
  );

  assert.throws(() => extrairTextoPdf(encriptado), ErroPdf);
  assert.throws(() => extrairTextoPdf(Buffer.from('não é um pdf')), ErroPdf);
});
