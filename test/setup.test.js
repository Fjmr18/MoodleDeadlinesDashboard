import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from 'node:util';
import {
  anoLetivoAtual,
  configuracaoPendente,
  construirUrlMoodle,
  gerarConteudoEnv,
  normalizarAnoLetivo,
  semestreInicioSugerido,
  validarConfiguracaoInicial,
} from '../server/setup.js';

const TOKEN_VALIDO = 'abc123DEF456ghi789';

test('o ano letivo por omissão muda em agosto', () => {
  assert.equal(anoLetivoAtual(new Date(2026, 10, 8)), '2627');
  assert.equal(anoLetivoAtual(new Date(2026, 7, 1)), '2627');
  assert.equal(anoLetivoAtual(new Date(2026, 6, 31)), '2526');
  assert.equal(anoLetivoAtual(new Date(2026, 0, 15)), '2526');
});

test('normaliza anos letivos consecutivos de quatro dígitos', () => {
  assert.equal(normalizarAnoLetivo('2627'), '2627');
  assert.equal(normalizarAnoLetivo(' 9900 '), '9900');
  assert.throws(() => normalizarAnoLetivo('2628'), /par consecutivo/);
  assert.throws(() => normalizarAnoLetivo('262'), /quatro dígitos/);
  assert.throws(() => normalizarAnoLetivo('abcd'), /quatro dígitos/);
  assert.throws(() => normalizarAnoLetivo(''), /quatro dígitos/);
});

test('constrói o URL do Moodle a partir do ano letivo', () => {
  assert.equal(
    construirUrlMoodle('2627', 'https://moodle.unips.pt'),
    'https://moodle.unips.pt/2627/',
  );
  assert.equal(
    construirUrlMoodle('2526', 'https://moodle.exemplo.pt/moodle'),
    'https://moodle.exemplo.pt/moodle/2526/',
  );
});

test('sugere o primeiro dia de aulas a partir do ano letivo', () => {
  assert.equal(semestreInicioSugerido('2627'), '2026-09-14');
  assert.equal(semestreInicioSugerido('2526'), '2025-09-14');
});

test('valida os dados do assistente e normaliza os campos', () => {
  const dados = validarConfiguracaoInicial({
    anoLetivo: '2627',
    numeroAluno: ' 123456 ',
    password: 'palavra-passe',
    semestreInicio: '2026-09-14',
  });

  assert.deepEqual(dados, {
    anoLetivo: '2627',
    numeroAluno: '123456',
    password: 'palavra-passe',
    semestreInicio: '2026-09-14',
  });

  const semAno = validarConfiguracaoInicial({
    numeroAluno: '123456',
    password: 'palavra-passe',
  });

  assert.equal(semAno.anoLetivo, anoLetivoAtual());
  assert.equal(semAno.semestreInicio, null);
});

test('rejeita dados inválidos do assistente', () => {
  const base = {
    anoLetivo: '2627',
    numeroAluno: '123456',
    password: 'palavra-passe',
  };

  assert.throws(
    () => validarConfiguracaoInicial({ ...base, numeroAluno: '' }),
    /número de aluno/,
  );
  assert.throws(
    () => validarConfiguracaoInicial({ ...base, numeroAluno: '123 456' }),
    /caracteres inválidos/,
  );
  assert.throws(
    () => validarConfiguracaoInicial({ ...base, password: '' }),
    /palavra-passe/,
  );
  assert.throws(
    () => validarConfiguracaoInicial({ ...base, semestreInicio: '14/09/2026' }),
    /AAAA-MM-DD/,
  );
  assert.throws(
    () => validarConfiguracaoInicial({ ...base, semestreInicio: '2026-02-30' }),
    /não existe/,
  );
});

test('considera a configuração pendente sem URL ou autenticação', () => {
  assert.equal(configuracaoPendente({}), true);
  assert.equal(
    configuracaoPendente({ MOODLE_URL: 'https://moodle.exemplo.pt' }),
    true,
  );
  assert.equal(
    configuracaoPendente({
      MOODLE_URL: 'https://moodle.exemplo.pt',
      MOODLE_USERNAME: '123456',
    }),
    true,
  );
  assert.equal(
    configuracaoPendente({
      MOODLE_URL: 'https://moodle.exemplo.pt',
      MOODLE_USERNAME: '123456',
      MOODLE_PASSWORD: 'segredo',
    }),
    false,
  );
  assert.equal(
    configuracaoPendente({
      MOODLE_URL: 'https://moodle.exemplo.pt',
      MOODLE_TOKEN: TOKEN_VALIDO,
    }),
    false,
  );
});

test('o .env gerado guarda o token e nunca a palavra-passe', () => {
  const conteudo = gerarConteudoEnv({
    urlMoodle: 'https://moodle.unips.pt/2627/',
    numeroAluno: '123456',
    token: TOKEN_VALIDO,
    semestreInicio: '2026-09-14',
  });

  const env = parseEnv(conteudo);

  assert.equal(env.MOODLE_URL, 'https://moodle.unips.pt/2627/');
  assert.equal(env.MOODLE_USERNAME, '123456');
  assert.equal(env.MOODLE_TOKEN, TOKEN_VALIDO);
  assert.equal(env.SEMESTER_START, '2026-09-14');
  assert.equal('MOODLE_PASSWORD' in env, false);
  assert.doesNotMatch(conteudo, /palavra-passe|MOODLE_PASSWORD/i);
});

test('omite o início do semestre quando não é indicado', () => {
  const conteudo = gerarConteudoEnv({
    urlMoodle: 'https://moodle.unips.pt/2627/',
    numeroAluno: '123456',
    token: TOKEN_VALIDO,
    semestreInicio: null,
  });

  assert.equal('SEMESTER_START' in parseEnv(conteudo), false);
});

test('recusa tokens com formatos inesperados', () => {
  const base = {
    urlMoodle: 'https://moodle.unips.pt/2627/',
    numeroAluno: '123456',
    semestreInicio: null,
  };

  assert.throws(
    () => gerarConteudoEnv({ ...base, token: 'curto' }),
    /formato inesperado/,
  );
  assert.throws(
    () => gerarConteudoEnv({ ...base, token: 'token com espaços' }),
    /formato inesperado/,
  );
  assert.throws(
    () => gerarConteudoEnv({ ...base, token: null }),
    /formato inesperado/,
  );
});
