#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ_PROJETO } from '../server/config.js';

// ---------------------------------------------------------------------------
// Comando de limpeza
//
// Remove tudo o que o Git ignora: segredos locais (.env), dados descarregados
// (data/), dependências (node_modules/) e ficheiros temporários. O .env.example
// e todo o código-fonte são preservados.
//
// Num repositório Git usa `git clean -X`, para respeitar automaticamente o
// .gitignore. Fora de um repositório usa a lista abaixo, que deve acompanhar o
// .gitignore do projeto.
// ---------------------------------------------------------------------------

const ALVOS_FIXOS = [
  'node_modules',
  '.env',
  'data',
  'logs',
  'tmp',
  'coverage',
  '.idea',
  '.vscode',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
];

const PADROES_FICHEIROS = [
  (nome) => nome.endsWith('.log'),
  (nome) => nome.startsWith('.env.') && nome !== '.env.example',
];

const argumentos = new Set(process.argv.slice(2));
const simulacao = argumentos.has('--sim') || argumentos.has('--dry-run');
const ajuda = argumentos.has('--ajuda') || argumentos.has('--help');

function mostrarAjuda() {
  console.log(`Limpeza dos ficheiros locais ignorados pelo Git.

Uso:
  npm run limpar              remove .env, data/, logs e outros ficheiros ignorados
  npm run limpar -- --sim     mostra o que seria removido, sem apagar nada
  npm run limpar -- --ajuda   mostra esta ajuda

O .env.example e todo o código-fonte são sempre preservados. Para antes o
servidor (Ctrl+C), caso esteja a correr.`);
}

function dentroDeRepositorioGit() {
  const resultado = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: RAIZ_PROJETO,
    encoding: 'utf8',
  });

  return resultado.status === 0 && resultado.stdout.trim() === 'true';
}

function listarIgnoradosComGit() {
  const resultado = spawnSync(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
    {
      cwd: RAIZ_PROJETO,
      encoding: 'utf8',
    },
  );

  if (resultado.error) {
    throw new Error(`Não foi possível executar o git: ${resultado.error.message}`);
  }

  if (resultado.status !== 0) {
    throw new Error(resultado.stderr.trim() || 'O git não conseguiu listar os ficheiros ignorados.');
  }

  return resultado.stdout
    .split('\0')
    .filter(Boolean)
    .map((caminho) => caminho.replace(/\/$/, ''));
}

function caminhoSeguro(relativo) {
  const absoluto = path.resolve(RAIZ_PROJETO, relativo);

  if (absoluto === RAIZ_PROJETO || !absoluto.startsWith(RAIZ_PROJETO + path.sep)) {
    throw new Error(`Caminho fora do projeto: ${relativo}`);
  }

  return absoluto;
}

async function existe(caminho) {
  try {
    await lstat(caminho);
    return true;
  } catch (erro) {
    if (erro.code === 'ENOENT') {
      return false;
    }

    throw erro;
  }
}

async function remover(relativo) {
  const absoluto = caminhoSeguro(relativo);

  if (!(await existe(absoluto))) {
    return false;
  }

  const informacao = await lstat(absoluto);
  const etiqueta = informacao.isDirectory() ? `${relativo}/` : relativo;

  if (!simulacao) {
    await rm(absoluto, { recursive: true, force: true });
  }

  console.log(`${simulacao ? 'Seria removido' : 'Removido'}: ${etiqueta}`);
  return true;
}

async function removerPadroes(diretorio = RAIZ_PROJETO, prefixo = '') {
  let removidos = 0;
  const entradas = await readdir(diretorio, { withFileTypes: true });

  for (const entrada of entradas) {
    if (entrada.name === '.git') {
      continue;
    }

    const relativo = prefixo ? path.join(prefixo, entrada.name) : entrada.name;
    const absoluto = path.join(diretorio, entrada.name);

    if (entrada.isDirectory()) {
      removidos += await removerPadroes(absoluto, relativo);
      continue;
    }

    const corresponde = PADROES_FICHEIROS.some((padrao) => padrao(entrada.name));

    if (corresponde && (await remover(relativo))) {
      removidos += 1;
    }
  }

  return removidos;
}

async function limparAlvos(alvos) {
  let removidos = 0;

  for (const alvo of alvos) {
    if (await remover(alvo)) {
      removidos += 1;
    }
  }

  return removidos;
}

function informarResultado(total) {
  if (total === 0) {
    console.log('Nada para limpar.');
    return;
  }

  console.log(`${simulacao ? 'Seriam removidos' : 'Removidos'} ${total} alvo(s).`);
}

async function limparSemGit() {
  const removidos = await limparAlvos(ALVOS_FIXOS);
  const deFicheiros = await removerPadroes();
  informarResultado(removidos + deFicheiros);
}

if (ajuda) {
  mostrarAjuda();
} else {
  try {
    console.log(
      simulacao
        ? 'A simular a limpeza dos ficheiros ignorados pelo Git…'
        : 'A limpar os ficheiros ignorados pelo Git…',
    );

    if (dentroDeRepositorioGit()) {
      informarResultado(await limparAlvos(listarIgnoradosComGit()));
    } else {
      await limparSemGit();
    }

    if (simulacao) {
      console.log('Simulação concluída. Nada foi apagado.');
    } else {
      console.log('Limpeza concluída. O próximo arranque volta a pedir a configuração.');
    }
  } catch (erro) {
    console.error(`Não foi possível limpar: ${erro.message}`);
    process.exitCode = 1;
  }
}
