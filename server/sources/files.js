import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ_PROJETO, lerNumeroEnv } from '../config.js';
import { extrairTextoPdf } from '../extractors/pdf.js';
import { extrairTextoPptx } from '../extractors/pptx.js';

const PASTA_FICHEIROS = path.join(RAIZ_PROJETO, 'data', 'files');
const PASTA_TEXTO = path.join(RAIZ_PROJETO, 'data', 'cache', 'texto');
const FICHEIRO_INVENTARIO = path.join(RAIZ_PROJETO, 'data', 'cache', 'ficheiros.json');

// Só estes formatos são descarregados e analisados nesta fase. DOCX fica para
// quando o extractor correspondente existir (ver plano no AGENTS.md).
const EXTENSOES_SUPORTADAS = new Set(['pdf', 'pptx']);

function lerLimiteMb(nome, defeito) {
  return lerNumeroEnv(nome, defeito, 0) * 1024 * 1024;
}

function extensaoDe(nome) {
  return path.extname(nome).slice(1).toLowerCase();
}

function sanitizarNome(nome) {
  const limpo = String(nome)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '');

  return (limpo || 'ficheiro').slice(0, 90);
}

function chaveDoFicheiro(url, tamanho, modificado) {
  return createHash('sha1')
    .update(`${url}|${tamanho}|${modificado}`)
    .digest('hex')
    .slice(0, 16);
}

function nomeDoCurso(curso) {
  return String(curso.fullname || curso.nome || 'Sem cadeira');
}

function nomeCurtoDoCurso(curso) {
  return String(curso.shortname || curso.curto || '—');
}

/**
 * Percorre as secções de um curso e devolve os ficheiros visíveis, com a
 * proveniência necessária para a interface e para o cache.
 */
export function extrairFicheirosDasSecoes(curso, secoes) {
  const ficheiros = [];
  const vistos = new Set();

  for (const secao of Array.isArray(secoes) ? secoes : []) {
    for (const modulo of secao.modules || []) {
      if (modulo.visible === 0 || modulo.uservisible === false) {
        continue;
      }

      for (const conteudo of modulo.contents || []) {
        if (conteudo.type !== 'file' || !conteudo.fileurl || !conteudo.filename) {
          continue;
        }

        const chave = `${conteudo.fileurl}|${conteudo.timemodified}|${conteudo.filesize}`;

        if (vistos.has(chave)) {
          continue;
        }
        vistos.add(chave);

        ficheiros.push({
          cursoId: Number(curso.id),
          curso: nomeDoCurso(curso),
          cursoCurto: nomeCurtoDoCurso(curso),
          nome: conteudo.filename,
          extensao: extensaoDe(conteudo.filename),
          tamanho: Number(conteudo.filesize) || 0,
          modificadoEm: conteudo.timemodified
            ? new Date(Number(conteudo.timemodified) * 1000).toISOString()
            : null,
          url: conteudo.fileurl,
          local: modulo.name || secao.name || 'Moodle',
        });
      }
    }
  }

  return ficheiros;
}

function lerInventarioGuardado() {
  return readFile(FICHEIRO_INVENTARIO, 'utf8')
    .then((texto) => {
      const dados = JSON.parse(texto);
      return dados && Array.isArray(dados.ficheiros) ? dados : null;
    })
    .catch((erro) => {
      if (erro.code === 'ENOENT' || erro instanceof SyntaxError) {
        return null;
      }
      throw erro;
    });
}

async function guardarInventario(dados) {
  await mkdir(path.dirname(FICHEIRO_INVENTARIO), { recursive: true });
  const temporario = `${FICHEIRO_INVENTARIO}.tmp`;
  await writeFile(temporario, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
  await rename(temporario, FICHEIRO_INVENTARIO);
}

export const lerInventarioFicheiros = lerInventarioGuardado;

function caminhoDoFicheiro(item, chave) {
  return path.join(PASTA_FICHEIROS, String(item.cursoId), `${chave}-${sanitizarNome(item.nome)}`);
}

function caminhoDoTexto(chave) {
  return path.join(PASTA_TEXTO, `${chave}.json`);
}

async function textoEmCache(chave) {
  try {
    const texto = await readFile(caminhoDoTexto(chave), 'utf8');
    const dados = JSON.parse(texto);
    return dados && typeof dados.texto === 'string' ? dados : null;
  } catch (erro) {
    if (erro.code === 'ENOENT' || erro instanceof SyntaxError) {
      return null;
    }
    throw erro;
  }
}

async function guardarTextoEmCache(chave, resultado) {
  await mkdir(PASTA_TEXTO, { recursive: true });
  const temporario = `${caminhoDoTexto(chave)}.tmp`;
  await writeFile(temporario, `${JSON.stringify(resultado)}\n`, 'utf8');
  await rename(temporario, caminhoDoTexto(chave));
}

async function extrairTexto(item, caminho) {
  const conteudo = await readFile(caminho);

  if (item.extensao === 'pdf') {
    return extrairTextoPdf(conteudo);
  }

  if (item.extensao === 'pptx') {
    return extrairTextoPptx(conteudo);
  }

  throw new Error(`Formato .${item.extensao} não suportado.`);
}

/**
 * Analisa os ficheiros das cadeiras: lista, descarrega com cache, extrai texto e
 * guarda um inventário. Os pedidos são sequenciais e uma falha isolada num
 * ficheiro não interrompe a análise.
 */
export async function analisarFicheiros(
  cliente,
  cursos,
  { aoAtualizar = () => {}, forcar = false } = {},
) {
  const limitePorCurso = lerNumeroEnv('MAX_FILES_PER_COURSE', 40, 0);
  const limiteFicheiro = lerLimiteMb('MAX_FILE_MB', 20);
  const limiteTotal = lerLimiteMb('MAX_TOTAL_MB', 250);

  const estado = {
    estado: 'a-analisar',
    iniciadoEm: new Date().toISOString(),
    terminadoEm: null,
    erro: null,
    avisos: [],
    progresso: {
      cursos: 0,
      totalCursos: cursos.length,
      ficheiros: 0,
      totalFicheiros: 0,
      extraidos: 0,
      ignorados: 0,
      erros: 0,
    },
    resumo: {
      ficheiros: 0,
      extraidos: 0,
      semTexto: 0,
      ignorados: 0,
      erros: 0,
      caracteres: 0,
      bytesDescarregados: 0,
    },
    ficheiros: [],
  };

  function atualizar() {
    estado.resumo.ficheiros = estado.ficheiros.length;
    aoAtualizar({ ...estado, progresso: { ...estado.progresso }, resumo: { ...estado.resumo } });
  }

  function registarIgnorado(item, motivo) {
    // O URL do Moodle não é exposto pela API nem guardado no inventário.
    const { url, ...resto } = item;
    estado.ficheiros.push({ ...resto, estado: 'ignorado', motivo });
    estado.resumo.ignorados += 1;
  }

  atualizar();
  let bytesBaixados = 0;

  for (const curso of cursos) {
    let secoes = [];

    try {
      secoes = await cliente.listarConteudosDoCurso(curso.id);
    } catch (erro) {
      if (erro.autenticacao) {
        throw erro;
      }
      estado.avisos.push(
        `Não foi possível listar os ficheiros de ${nomeCurtoDoCurso(curso)}: ${erro.message}`,
      );
      estado.progresso.cursos += 1;
      atualizar();
      continue;
    }

    const encontrados = extrairFicheirosDasSecoes(curso, secoes);
    const suportados = [];

    for (const item of encontrados) {
      if (!EXTENSOES_SUPORTADAS.has(item.extensao)) {
        continue;
      }

      if (item.tamanho === 0) {
        registarIgnorado(item, 'Ficheiro vazio.');
        continue;
      }

      if (item.tamanho > limiteFicheiro) {
        registarIgnorado(
          item,
          `Maior do que o limite de ${(limiteFicheiro / 1024 / 1024).toFixed(0)} MB.`,
        );
        continue;
      }

      if (limitePorCurso > 0 && suportados.length >= limitePorCurso) {
        registarIgnorado(item, `Limite de ${limitePorCurso} ficheiros por cadeira.`);
        continue;
      }

      suportados.push(item);
    }

    estado.progresso.totalFicheiros += suportados.length;
    atualizar();

    for (const item of suportados) {
      const chave = chaveDoFicheiro(item.url, item.tamanho, item.modificadoEm);
      const destino = caminhoDoFicheiro(item, chave);
      const itemPublico = {
        id: chave,
        cursoId: item.cursoId,
        curso: item.curso,
        cursoCurto: item.cursoCurto,
        nome: item.nome,
        extensao: item.extensao,
        tamanho: item.tamanho,
        modificadoEm: item.modificadoEm,
        local: item.local,
        estado: 'pendente',
        motivo: null,
        caracteres: 0,
        paginas: 0,
        avisos: [],
        analisadoEm: null,
      };

      estado.ficheiros.push(itemPublico);
      estado.progresso.ficheiros += 1;

      try {
        const precisaDescarregar =
          forcar || !(await existeComTamanho(destino, item.tamanho));

        // O limite total só se aplica a downloads novos; ficheiros já em cache
        // continuam a ser analisados sem consumir o orçamento desta execução.
        if (
          precisaDescarregar &&
          limiteTotal > 0 &&
          bytesBaixados + item.tamanho > limiteTotal
        ) {
          itemPublico.estado = 'ignorado';
          itemPublico.motivo = `Limite total de ${(limiteTotal / 1024 / 1024).toFixed(0)} MB atingido.`;
          estado.resumo.ignorados += 1;
          estado.progresso.ignorados += 1;
          atualizar();
          continue;
        }

        if (precisaDescarregar) {
          await cliente.descarregarFicheiro(item.url, destino);
          bytesBaixados += item.tamanho;
          estado.resumo.bytesDescarregados += item.tamanho;
        }

        let extraido = forcar ? null : await textoEmCache(chave);

        if (!extraido) {
          extraido = await extrairTexto(item, destino);
          await guardarTextoEmCache(chave, extraido);
        }

        itemPublico.caracteres = extraido.texto.length;
        itemPublico.paginas = extraido.paginas.length;
        itemPublico.avisos = (extraido.avisos || []).slice(0, 3);
        itemPublico.analisadoEm = new Date().toISOString();
        itemPublico.estado = extraido.texto.trim() ? 'extraido' : 'sem-texto';

        if (itemPublico.estado === 'extraido') {
          estado.resumo.extraidos += 1;
          estado.progresso.extraidos += 1;
          estado.resumo.caracteres += itemPublico.caracteres;
        } else {
          estado.resumo.semTexto += 1;
        }
      } catch (erro) {
        if (erro.autenticacao) {
          throw erro;
        }

        itemPublico.estado = 'erro';
        itemPublico.motivo = erro.message;
        estado.resumo.erros += 1;
        estado.progresso.erros += 1;
      }

      atualizar();
    }

    estado.progresso.cursos += 1;
    atualizar();
  }

  estado.estado = 'concluido';
  estado.terminadoEm = new Date().toISOString();
  estado.resumo.ficheiros = estado.ficheiros.length;
  estado.cursos = cursos.map((curso) => ({
    id: Number(curso.id),
    nome: nomeDoCurso(curso),
    curto: nomeCurtoDoCurso(curso),
  }));
  atualizar();
  await guardarInventario(estado);
  return estado;
}

async function existeComTamanho(caminho, tamanho) {
  try {
    const informacao = await stat(caminho);
    return informacao.size === tamanho;
  } catch (erro) {
    if (erro.code === 'ENOENT') {
      return false;
    }
    throw erro;
  }
}
