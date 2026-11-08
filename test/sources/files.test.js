import assert from 'node:assert/strict';
import test from 'node:test';
import { extrairFicheirosDasSecoes } from '../../server/sources/files.js';

const curso = { id: 42, fullname: 'Programação Web I', shortname: 'PWI26-LEI' };

function ficheiro(nome, extra = {}) {
  return {
    type: 'file',
    filename: nome,
    fileurl: `https://moodle.exemplo.pt/webservice/pluginfile.php/1/${nome}`,
    filesize: 1234,
    timemodified: 1790000000,
    ...extra,
  };
}

test('recolhe ficheiros visíveis com a proveniência da secção e do módulo', () => {
  const secoes = [
    {
      name: 'Semana 01',
      modules: [
        {
          name: 'Teórica',
          visible: 1,
          contents: [ficheiro('slides.pdf'), ficheiro('notas.pptx')],
        },
      ],
    },
  ];

  const ficheiros = extrairFicheirosDasSecoes(curso, secoes);

  assert.equal(ficheiros.length, 2);
  assert.equal(ficheiros[0].cursoId, 42);
  assert.equal(ficheiros[0].curso, 'Programação Web I');
  assert.equal(ficheiros[0].cursoCurto, 'PWI26-LEI');
  assert.equal(ficheiros[0].extensao, 'pdf');
  assert.equal(ficheiros[0].local, 'Teórica');
  assert.equal(ficheiros[1].extensao, 'pptx');
  assert.equal(ficheiros[0].modificadoEm, '2026-09-21T14:13:20.000Z');
});

test('ignora módulos ocultos, conteúdos que não são ficheiros e duplicados', () => {
  const secoes = [
    {
      name: 'Geral',
      modules: [
        { name: 'Oculto', visible: 0, contents: [ficheiro('oculto.pdf')] },
        {
          name: 'Página',
          contents: [{ type: 'url', name: 'Ligação' }, ficheiro('visivel.pdf')],
        },
      ],
    },
    {
      name: 'Semana 02',
      modules: [{ name: 'Repetido', contents: [ficheiro('visivel.pdf')] }],
    },
  ];

  const ficheiros = extrairFicheirosDasSecoes(curso, secoes);

  assert.deepEqual(
    ficheiros.map((item) => item.nome),
    ['visivel.pdf'],
  );
});

test('tolera secções e módulos sem conteúdos', () => {
  assert.deepEqual(extrairFicheirosDasSecoes(curso, []), []);
  assert.deepEqual(extrairFicheirosDasSecoes(curso, [{ name: 'Vazia' }]), []);
});
