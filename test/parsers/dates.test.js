import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classificarTipoEvento,
  descodificarEntidades,
  extrairDatasDoTexto,
  extrairTituloDoEvento,
  limparHtml,
  normalizarParaComparacao,
  normalizarTextoExtraido,
} from '../../server/parsers/dates.js';

const OPCOES_EXTRACAO = {
  inicioSemestre: '2026-09-14',
  fuso: 'Europe/Lisbon',
  nomeFicheiro: 'Projeto-1.pdf',
};

test('descodifica entidades HTML do Moodle', () => {
  assert.equal(descodificarEntidades('Termina o prazo de &#039;LAB_03&#039;'), "Termina o prazo de 'LAB_03'");
  assert.equal(descodificarEntidades('A &amp; B &quot;C&quot;'), 'A & B "C"');
});

test('limpa HTML e colapsa espaços', () => {
  assert.equal(
    limparHtml('<p><strong>LAB03</strong> | HTML5&nbsp;e CSS</p><p>Entrega</p>'),
    'LAB03 | HTML5 e CSS Entrega',
  );
});

test('normaliza texto sem acentos para comparação', () => {
  assert.equal(normalizarParaComparacao('Programação e Avaliação'), 'programacao e avaliacao');
});

test('extrai o título de eventos com prefixo do Moodle', () => {
  assert.equal(
    extrairTituloDoEvento("Termina o prazo de 'LAB_03 - Turma PL6'"),
    'LAB_03 - Turma PL6',
  );
  assert.equal(
    extrairTituloDoEvento('Fecha &#039;Inscrições para o Mini-Teste TP/Ficha dia 11/11&#039;'),
    'Inscrições para o Mini-Teste TP/Ficha dia 11/11',
  );
  assert.equal(extrairTituloDoEvento('Entrega do 1º Projeto'), 'Entrega do 1º Projeto');
});

test('classifica testes, exames e entregas', () => {
  assert.equal(
    classificarTipoEvento({ nome: 'Teste 1 - Prof. Filipe Mariano', modulo: 'quiz' }),
    'teste',
  );
  assert.equal(
    classificarTipoEvento({ nome: 'Inscrições para o Mini-Teste TP/Ficha' }),
    'teste',
  );
  assert.equal(classificarTipoEvento({ nome: 'Exame de época especial' }), 'exame');
  assert.equal(
    classificarTipoEvento({ nome: 'LAB_03 - Turma PL6', modulo: 'assign' }),
    'entrega',
  );
  assert.equal(
    classificarTipoEvento({ nome: 'Entrega do Projeto - Época Especial', modulo: 'assign' }),
    'entrega',
  );
  assert.equal(classificarTipoEvento({ nome: 'Reunião de grupo' }), 'outro');
});

test('extrai uma data por extenso com hora e título do projeto', () => {
  const [evento] = extrairDatasDoTexto(
    '7. Datas 18 de Dezembro de 2026, até às 23:59. 8. Documentação a Entregar',
    OPCOES_EXTRACAO,
  );

  assert.equal(evento.date, '2026-12-18T23:59:00.000Z');
  assert.equal(evento.dateConfidence, 'exact');
  assert.equal(evento.type, 'entrega');
  assert.equal(evento.title, 'Projeto 1');
  assert.match(evento.snippet, /18 de Dezembro de 2026/);
});

test('extrai datas numéricas com barra, hífen e ponto', () => {
  for (const texto of [
    'A entrega do trabalho é a 18/12/2026.',
    'A entrega do trabalho é a 18-12-2026.',
    'A entrega do trabalho é a 18.12.2026.',
  ]) {
    const [evento] = extrairDatasDoTexto(texto, OPCOES_EXTRACAO);
    assert.equal(evento.date, '2026-12-18T23:59:00.000Z');
    assert.equal(evento.type, 'entrega');
  }
});

test('infere o ano letivo quando a data não tem ano', () => {
  const [dezembro] = extrairDatasDoTexto(
    'A entrega do projeto é a 18 de dezembro.',
    OPCOES_EXTRACAO,
  );
  const [janeiro] = extrairDatasDoTexto(
    'O exame é a 8 de janeiro.',
    OPCOES_EXTRACAO,
  );

  assert.equal(dezembro.date, '2026-12-18T23:59:00.000Z');
  assert.equal(dezembro.dateConfidence, 'unclear');
  assert.equal(janeiro.date, '2027-01-08T23:59:00.000Z');
});

test('corrige anos partidos por quebras de linha em tabelas PDF', () => {
  const eventos = extrairDatasDoTexto(
    'Teste 1: 23 de outubro de 202 6 (6.ª feira) às 9h ' +
      'Teste 2: 4 de dezembro de 202 6 (6.ª feira) às 9h',
    OPCOES_EXTRACAO,
  );

  assert.deepEqual(
    eventos.map((evento) => [evento.date, evento.title, evento.type]),
    [
      ['2026-10-23T08:00:00.000Z', 'Teste 1', 'teste'],
      ['2026-12-04T09:00:00.000Z', 'Teste 2', 'teste'],
    ],
  );
});

test('converte "semana N" numa data baseada no início do semestre', () => {
  const [evento] = extrairDatasDoTexto('Teste na semana 7', {
    ...OPCOES_EXTRACAO,
    nomeFicheiro: 'planificacao.pdf',
  });

  assert.equal(evento.date, '2026-10-26T09:00:00.000Z');
  assert.equal(evento.dateConfidence, 'week-based');
  assert.equal(evento.semana, 7);
  assert.equal(evento.type, 'teste');
});

test('ignora datas sem contexto de avaliação e contextos irrelevantes', () => {
  assert.deepEqual(
    extrairDatasDoTexto('2 de 47 31/08/2016 02:52', OPCOES_EXTRACAO),
    [],
  );
  assert.deepEqual(
    extrairDatasDoTexto('Horas por Semana 4', OPCOES_EXTRACAO),
    [],
  );
  assert.deepEqual(
    extrairDatasDoTexto(
      'Diário da República, 2.ª série, n.º 49, de 11 de março de 2026.',
      OPCOES_EXTRACAO,
    ),
    [],
  );
  assert.deepEqual(
    extrairDatasDoTexto('A reunião de grupo é a 12 de maio.', OPCOES_EXTRACAO),
    [],
  );
});

test('normaliza espaços e anos separados no texto extraído', () => {
  assert.equal(
    normalizarTextoExtraido('Avaliação\n202 6   e\t20 2 7'),
    'Avaliação 2026 e 2027',
  );
});
