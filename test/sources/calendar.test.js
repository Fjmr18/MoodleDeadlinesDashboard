import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combinarEventos,
  normalizarEventoCalendario,
  normalizarTarefa,
  recolherDadosDashboard,
} from '../../server/sources/calendar.js';

const URL_BASE = 'https://moodle.exemplo.pt/';
const DATA_FUTURA = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

function eventoFuturo(extra = {}) {
  return {
    id: 101,
    name: "Termina o prazo de &#039;LAB_03 - Turma PL6&#039;",
    description: '<p><strong>LAB03</strong> | HTML5 e CSS</p>',
    activityname: 'LAB_03 - Turma PL6',
    modulename: 'assign',
    eventtype: 'due',
    timestart: DATA_FUTURA,
    visible: 1,
    url: 'https://moodle.exemplo.pt/mod/assign/view.php?id=1',
    course: {
      id: 1281,
      fullname: 'Programação Web I 2026/2027 - LEI',
      shortname: 'PWI26-LEI',
    },
    ...extra,
  };
}

test('normaliza um evento do calendário no modelo do projeto', () => {
  const evento = normalizarEventoCalendario(eventoFuturo(), new Map());

  assert.equal(evento.id, 'calendario-101');
  assert.equal(evento.courseId, 1281);
  assert.equal(evento.courseShort, 'PWI26-LEI');
  assert.equal(evento.title, 'LAB_03 - Turma PL6');
  assert.equal(evento.type, 'entrega');
  assert.equal(evento.status, 'confirmed');
  assert.equal(evento.dateConfidence, 'exact');
  assert.equal(evento.source.kind, 'calendar');
  assert.equal(evento.source.snippet, 'LAB03 | HTML5 e CSS');
});

test('ignora eventos de abertura e eventos sem data', () => {
  assert.equal(normalizarEventoCalendario(eventoFuturo({ eventtype: 'open' })), null);
  assert.equal(normalizarEventoCalendario(eventoFuturo({ timestart: 0 })), null);
});

test('normaliza uma tarefa e constrói a ligação da atividade', () => {
  const tarefa = normalizarTarefa(
    {
      id: 1281,
      fullname: 'Programação Web I 2026/2027 - LEI',
      shortname: 'PWI26-LEI',
    },
    {
      id: 99,
      cmid: 555,
      name: 'LAB_03 - Turma PL6',
      duedate: DATA_FUTURA,
      intro: '<p>Entrega do laboratório</p>',
    },
    URL_BASE,
  );

  assert.equal(tarefa.id, 'tarefa-1281-99');
  assert.equal(tarefa.type, 'entrega');
  assert.equal(tarefa.source.location, 'Tarefas do Moodle');
  assert.equal(tarefa.source.url, 'https://moodle.exemplo.pt/mod/assign/view.php?id=555');
});

test('junta calendário e tarefas sem duplicar o mesmo prazo', () => {
  const calendario = normalizarEventoCalendario(eventoFuturo(), new Map());
  const eventos = combinarEventos(
    [calendario],
    [
      {
        id: 1281,
        fullname: 'Programação Web I 2026/2027 - LEI',
        shortname: 'PWI26-LEI',
        assignments: [
          {
            id: 99,
            cmid: 555,
            name: 'LAB_03 - Turma PL6',
            duedate: DATA_FUTURA,
            intro: '<p>Descrição mais completa da tarefa para o dashboard.</p>',
          },
        ],
      },
    ],
    URL_BASE,
  );

  assert.equal(eventos.length, 1);
  assert.match(eventos[0].source.snippet, /Descrição mais completa/);
});

test('recolhe o calendário das cadeiras numa única chamada', async () => {
  const chamadas = [];
  const cliente = {
    urlBase: URL_BASE,
    async obterSiteInfo() {
      return {
        sitename: 'Moodle de Teste',
        fullname: 'Estudante Exemplo',
        firstname: 'Estudante',
        userid: 7,
      };
    },
    async listarCursos() {
      return [
        { id: 1281, fullname: 'Programação Web I', shortname: 'PWI26-LEI' },
        { id: 2674, fullname: 'Fundamentos de IA', shortname: 'FIA_LEI' },
      ];
    },
    async listarEventosDasCadeiras(ids) {
      chamadas.push({ metodo: 'varias', ids });
      return [
        { ...eventoFuturo(), course: undefined, courseid: 1281 },
        { ...eventoFuturo({ id: 102 }), course: undefined, courseid: 2674 },
      ];
    },
    async listarEventosDoCurso() {
      chamadas.push({ metodo: 'curso' });
      return [];
    },
    async obterTarefas(ids) {
      chamadas.push({ metodo: 'tarefas', ids });
      return [];
    },
  };

  const dados = await recolherDadosDashboard(cliente);

  assert.deepEqual(chamadas, [
    { metodo: 'varias', ids: [1281, 2674] },
    { metodo: 'tarefas', ids: [1281, 2674] },
  ]);
  assert.equal(dados.eventos.length, 2);
  assert.equal(
    dados.eventos.find((evento) => evento.courseId === 1281).courseShort,
    'PWI26-LEI',
  );
});
