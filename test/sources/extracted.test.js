import assert from 'node:assert/strict';
import test from 'node:test';
import {
  construirEventoExtraido,
  criarLimitesPeriodo,
  dentroDoPeriodo,
} from '../../server/sources/extracted.js';

const CANDIDATO = {
  date: '2026-12-18T23:59:00.000Z',
  dateConfidence: 'exact',
  type: 'entrega',
  title: 'Projeto 1',
  snippet: '7. Datas 18 de Dezembro de 2026, até às 23:59.',
  semana: null,
};

function itemInventario(extra = {}) {
  return {
    id: 'abc123',
    nome: 'Projeto-1.pdf',
    cursoId: 12,
    curso: 'Programação Web II',
    cursoCurto: 'PWII-LEI',
    estado: 'extraido',
    ...extra,
  };
}

test('calcula a janela letiva a partir do início do semestre', () => {
  const limites = criarLimitesPeriodo({ inicioSemestre: '2026-09-14' });

  assert.deepEqual(limites, {
    inicio: '2026-07-31T00:00:00.000Z',
    fim: '2027-10-19T00:00:00.000Z',
  });
});

test('usa a data atual quando o semestre não está configurado', () => {
  const limites = criarLimitesPeriodo({
    inicioSemestre: 'data-invalida',
    agora: new Date(2026, 10, 8, 15, 30),
  });

  assert.deepEqual(limites, {
    inicio: '2026-09-24T00:00:00.000Z',
    fim: '2027-12-13T00:00:00.000Z',
  });
});

test('aceita datas dentro da janela e rejeita as de anos anteriores', () => {
  const limites = criarLimitesPeriodo({ inicioSemestre: '2026-09-14' });

  assert.equal(dentroDoPeriodo('2026-12-18T23:59:00.000Z', limites), true);
  assert.equal(dentroDoPeriodo('2027-01-08T23:59:00.000Z', limites), true);
  assert.equal(dentroDoPeriodo('2023-04-02T22:59:00.000Z', limites), false);
  assert.equal(dentroDoPeriodo('2028-01-01T00:00:00.000Z', limites), false);
  assert.equal(dentroDoPeriodo('2026-12-18T23:59:00.000Z', null), true);
});

test('constrói um evento de ficheiro normalizado e por rever', () => {
  const evento = construirEventoExtraido(
    itemInventario(),
    { numero: 3, texto: 'texto completo do documento' },
    CANDIDATO,
    'pdf',
  );

  assert.match(evento.id, /^ficheiro-abc123-[0-9a-f]{12}$/);
  assert.equal(evento.courseId, 12);
  assert.equal(evento.course, 'Programação Web II');
  assert.equal(evento.courseShort, 'PWII-LEI');
  assert.equal(evento.type, 'entrega');
  assert.equal(evento.title, 'Projeto 1');
  assert.equal(evento.date, '2026-12-18T23:59:00.000Z');
  assert.equal(evento.dateConfidence, 'exact');
  assert.equal(evento.status, 'needs-review');
  assert.deepEqual(evento.source, {
    kind: 'file',
    file: 'Projeto-1.pdf',
    location: 'página 3',
    snippet: CANDIDATO.snippet,
    url: null,
  });
  assert.deepEqual(evento.review, {
    originalDate: '2026-12-18T23:59:00.000Z',
    originalTitle: 'Projeto 1',
    parser: 'datas-3',
    semana: null,
  });
});

test('identifica o slide nos documentos PPTX e não expõe o texto completo', () => {
  const evento = construirEventoExtraido(
    itemInventario({ nome: 'Aula-7.pptx' }),
    { numero: 2, texto: 'texto completo do slide' },
    CANDIDATO,
    'pptx',
  );

  assert.equal(evento.source.location, 'slide 2');
  assert.equal(evento.source.snippet, CANDIDATO.snippet);
  assert.equal(JSON.stringify(evento).includes('texto completo do slide'), false);
});

test('gera identificadores estáveis para o mesmo candidato', () => {
  const pagina = { numero: 1, texto: 'texto' };
  const primeiro = construirEventoExtraido(itemInventario(), pagina, CANDIDATO, 'pdf');
  const segundo = construirEventoExtraido(itemInventario(), pagina, CANDIDATO, 'pdf');
  const outro = construirEventoExtraido(
    itemInventario(),
    pagina,
    { ...CANDIDATO, title: 'Projeto 2' },
    'pdf',
  );

  assert.equal(primeiro.id, segundo.id);
  assert.notEqual(primeiro.id, outro.id);
});

test('preserva o número da semana quando a data foi calculada', () => {
  const evento = construirEventoExtraido(
    itemInventario(),
    { numero: 1, texto: 'texto' },
    {
      ...CANDIDATO,
      date: '2026-10-26T09:00:00.000Z',
      dateConfidence: 'week-based',
      semana: 7,
    },
    'pdf',
  );

  assert.equal(evento.dateConfidence, 'week-based');
  assert.equal(evento.review.semana, 7);
});
