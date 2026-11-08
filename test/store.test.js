import assert from 'node:assert/strict';
import test from 'node:test';
import { ACOES_REVISAO, aplicarOverrides } from '../server/store.js';

function eventoFicheiro(id = 'ficheiro-1-abc', extra = {}) {
  return {
    id,
    courseId: 7,
    course: 'Programação Web I',
    courseShort: 'PWI26-LEI',
    type: 'teste',
    title: 'Teste 1',
    date: '2026-10-23T08:00:00.000Z',
    dateConfidence: 'unclear',
    source: {
      kind: 'file',
      file: 'planificacao.pdf',
      location: 'página 3',
      snippet: 'Teste 1: 23 de outubro',
      url: null,
    },
    status: 'needs-review',
    review: {
      originalDate: '2026-10-23T08:00:00.000Z',
      originalTitle: 'Teste 1',
      parser: 'datas-3',
      semana: null,
    },
    ...extra,
  };
}

function eventoCalendario() {
  return {
    id: 'moodle-42',
    courseId: 7,
    course: 'Programação Web I',
    courseShort: 'PWI26-LEI',
    type: 'entrega',
    title: 'LAB_03',
    date: '2026-11-02T23:59:00.000Z',
    dateConfidence: 'exact',
    source: { kind: 'calendar', location: 'Moodle', url: 'https://moodle.exemplo.pt/mod/x' },
    status: 'confirmed',
  };
}

test('reconhece apenas as ações de revisão previstas', () => {
  assert.deepEqual([...ACOES_REVISAO].sort(), ['confirm', 'correct', 'dismiss']);
});

test('sem decisões, as datas de ficheiros continuam por rever', () => {
  const { eventos, resumo } = aplicarOverrides([eventoFicheiro(), eventoCalendario()]);

  assert.equal(eventos.length, 2);
  assert.equal(eventos.find((evento) => evento.id === 'ficheiro-1-abc').status, 'needs-review');
  assert.equal(eventos.find((evento) => evento.id === 'moodle-42').status, 'confirmed');
  assert.deepEqual(resumo, {
    porRever: 1,
    confirmadas: 0,
    descartadas: 0,
    corrigidas: 0,
  });
});

test('confirmar uma sugestão torna-a oficial e conta-a à parte', () => {
  const { eventos, resumo } = aplicarOverrides([eventoFicheiro()], {
    'ficheiro-1-abc': {
      action: 'confirm',
      atualizadoEm: '2026-11-08T10:00:00.000Z',
    },
  });

  const [evento] = eventos;
  assert.equal(evento.status, 'confirmed');
  assert.equal(evento.review.acao, 'confirm');
  assert.equal(evento.review.atualizadoEm, '2026-11-08T10:00:00.000Z');
  assert.equal(evento.dateConfidence, 'unclear');
  assert.equal(resumo.confirmadas, 1);
  assert.equal(resumo.porRever, 0);
});

test('corrigir aplica data e título e marca a data como exata', () => {
  const { eventos, resumo } = aplicarOverrides([eventoFicheiro()], {
    'ficheiro-1-abc': {
      action: 'correct',
      date: '2026-12-04T09:00:00.000Z',
      title: 'Teste 2 (sala B)',
      atualizadoEm: '2026-11-08T10:00:00.000Z',
    },
  });

  const [evento] = eventos;
  assert.equal(evento.status, 'confirmed');
  assert.equal(evento.date, '2026-12-04T09:00:00.000Z');
  assert.equal(evento.title, 'Teste 2 (sala B)');
  assert.equal(evento.dateConfidence, 'exact');
  assert.equal(evento.review.corrigida, true);
  assert.equal(evento.review.originalDate, '2026-10-23T08:00:00.000Z');
  assert.equal(resumo.corrigidas, 1);
  assert.equal(resumo.confirmadas, 1);
});

test('descartar mantém o evento na lista para poder ser recuperado', () => {
  const { eventos, resumo } = aplicarOverrides([eventoFicheiro()], {
    'ficheiro-1-abc': {
      action: 'dismiss',
      atualizadoEm: '2026-11-08T10:00:00.000Z',
    },
  });

  const [evento] = eventos;
  assert.equal(evento.status, 'dismissed');
  assert.equal(evento.review.acao, 'dismiss');
  assert.equal(resumo.descartadas, 1);
  assert.equal(resumo.porRever, 0);
});

test('as decisões não alteram os eventos oficiais do Moodle', () => {
  const oficial = eventoCalendario();
  const { eventos, resumo } = aplicarOverrides([oficial], {
    'moodle-42': {
      action: 'dismiss',
      atualizadoEm: '2026-11-08T10:00:00.000Z',
    },
  });

  assert.equal(eventos[0].status, 'confirmed');
  assert.equal(eventos[0].title, 'LAB_03');
  assert.deepEqual(resumo, {
    porRever: 0,
    confirmadas: 0,
    descartadas: 0,
    corrigidas: 0,
  });
});

test('não modifica os objetos recebidos e ordena por data', () => {
  const primeiro = eventoFicheiro('ficheiro-1-abc');
  const segundo = eventoFicheiro('ficheiro-2-def', {
    date: '2026-09-30T08:00:00.000Z',
    title: 'Teste 0',
  });

  const { eventos } = aplicarOverrides([primeiro, segundo], {
    'ficheiro-1-abc': {
      action: 'correct',
      date: '2026-12-04T09:00:00.000Z',
      title: 'Teste corrigido',
    },
  });

  assert.equal(primeiro.status, 'needs-review');
  assert.equal(primeiro.title, 'Teste 1');
  assert.equal(primeiro.date, '2026-10-23T08:00:00.000Z');
  assert.deepEqual(
    eventos.map((evento) => evento.id),
    ['ficheiro-2-def', 'ficheiro-1-abc'],
  );
});
