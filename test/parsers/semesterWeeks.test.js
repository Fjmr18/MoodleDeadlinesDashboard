import assert from 'node:assert/strict';
import test from 'node:test';
import {
  criarDataNoFuso,
  dataDaSemana,
  extrairSemanasDoTexto,
  normalizarFuso,
} from '../../server/parsers/semesterWeeks.js';

test('converte a semana 1 no início do semestre', () => {
  const data = dataDaSemana(1, {
    inicioSemestre: '2026-09-14',
    fuso: 'Europe/Lisbon',
  });

  assert.equal(data.toISOString(), '2026-09-14T08:00:00.000Z');
});

test('converte semanas depois da mudança de hora', () => {
  const setima = dataDaSemana(7, {
    inicioSemestre: '2026-09-14',
    fuso: 'Europe/Lisbon',
  });
  const dezasseis = dataDaSemana(16, {
    inicioSemestre: '2026-09-14',
    fuso: 'Europe/Lisbon',
  });

  assert.equal(setima.toISOString(), '2026-10-26T09:00:00.000Z');
  assert.equal(dezasseis.toISOString(), '2026-12-28T09:00:00.000Z');
});

test('rejeita números de semana inválidos', () => {
  assert.equal(dataDaSemana(0, { inicioSemestre: '2026-09-14' }), null);
  assert.equal(dataDaSemana(61, { inicioSemestre: '2026-09-14' }), null);
  assert.equal(dataDaSemana('sete', { inicioSemestre: '2026-09-14' }), null);
  assert.equal(dataDaSemana(7, { inicioSemestre: 'invalido' }), null);
});

test('encontra referências a semanas com número romano ou ordinal', () => {
  const semanas = extrairSemanasDoTexto(
    'Entrega na semana 7 e teste na Semana nº 8. Horas por Semana 4.',
    { inicioSemestre: '2026-09-14', fuso: 'Europe/Lisbon' },
  );

  assert.deepEqual(
    semanas.map((semana) => semana.numero),
    [7, 8, 4],
  );
  assert.equal(semanas[0].data.toISOString(), '2026-10-26T09:00:00.000Z');
});

test('constrói datas civis no fuso de Lisboa', () => {
  assert.equal(
    criarDataNoFuso(2026, 12, 18, 23, 59, 'Europe/Lisbon').toISOString(),
    '2026-12-18T23:59:00.000Z',
  );
  assert.equal(
    criarDataNoFuso(2026, 9, 11, 23, 55, 'Europe/Lisbon').toISOString(),
    '2026-09-11T22:55:00.000Z',
  );
});

test('usa um fuso de recurso quando o valor é inválido', () => {
  assert.equal(normalizarFuso('Fuso/Que-Nao-Existe'), 'Europe/Lisbon');
  assert.equal(normalizarFuso('Europe/Lisbon'), 'Europe/Lisbon');
});
