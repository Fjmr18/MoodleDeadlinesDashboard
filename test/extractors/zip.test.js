import assert from 'node:assert/strict';
import test from 'node:test';
import { ErroZip, lerZip } from '../../server/extractors/zip.js';
import { criarZipFicheiro } from '../ajudantes/ficheiros.js';

test('lê entradas ZIP sem compressão e com deflate', () => {
  const zip = lerZip(
    criarZipFicheiro([
      ['topico/ola.txt', 'Olá, Moodle!', false],
      ['ppt/slides/slide1.xml', '<a:t>Entrega</a:t>', true],
    ]),
  );

  assert.deepEqual(zip.nomes().sort(), ['ppt/slides/slide1.xml', 'topico/ola.txt']);
  assert.equal(zip.ler('topico/ola.txt').toString('utf8'), 'Olá, Moodle!');
  assert.equal(zip.ler('ppt/slides/slide1.xml').toString('utf8'), '<a:t>Entrega</a:t>');
});

test('rejeita ficheiros que não são ZIP', () => {
  assert.throws(() => lerZip(Buffer.from('isto não é um zip')), ErroZip);
  assert.throws(() => lerZip(Buffer.alloc(0)), ErroZip);
});
