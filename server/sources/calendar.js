import { urlDoMoodle } from '../config.js';
import {
  classificarTipoEvento,
  extrairTituloDoEvento,
  limparHtml,
  normalizarParaComparacao,
} from '../parsers/dates.js';

// Eventos antigos só aparecem na vista "Passados" durante este período.
const DIAS_HISTORICO = 90;
const LIMITE_SNIPPET = 280;

function urlSegura(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function resumirDescricao(descricao) {
  const texto = limparHtml(descricao);
  return texto.length > LIMITE_SNIPPET
    ? `${texto.slice(0, LIMITE_SNIPPET).trimEnd()}…`
    : texto;
}

function chaveDoEvento(evento) {
  return [
    evento.courseId ?? '',
    normalizarParaComparacao(evento.title),
    evento.date.slice(0, 16),
  ].join('|');
}

function dadosDoCurso(evento, cursosPorId) {
  const curso = evento.course || cursosPorId.get(Number(evento.courseid));

  return {
    id: Number(curso?.id ?? evento.courseid) || null,
    nome: limparHtml(curso?.fullname || '') || 'Sem cadeira',
    curto: limparHtml(curso?.shortname || '') || '—',
  };
}

/**
 * Converte um evento do calendário do Moodle no modelo normalizado do projeto.
 * Eventos de abertura de atividades não são prazos e por isso são ignorados.
 */
export function normalizarEventoCalendario(evento, cursosPorId = new Map()) {
  if (!evento || !evento.timestart || evento.eventtype === 'open' || evento.visible === 0) {
    return null;
  }

  const curso = dadosDoCurso(evento, cursosPorId);
  const titulo = extrairTituloDoEvento(evento.name, evento.activityname);

  if (!titulo) {
    return null;
  }

  return {
    id: `calendario-${evento.id}`,
    courseId: curso.id,
    course: curso.nome,
    courseShort: curso.curto,
    type: classificarTipoEvento({
      nome: evento.name,
      nomeAtividade: evento.activityname,
      modulo: evento.modulename,
      descricao: evento.description,
    }),
    title: titulo,
    date: new Date(Number(evento.timestart) * 1000).toISOString(),
    dateConfidence: 'exact',
    source: {
      kind: 'calendar',
      file: null,
      location: 'Calendário Moodle',
      snippet: resumirDescricao(evento.description),
      url: urlSegura(evento.url || evento.viewurl),
    },
    status: 'confirmed',
    moodle: {
      eventType: evento.eventtype || null,
      module: evento.modulename || null,
      activity: limparHtml(evento.activityname || '') || null,
    },
  };
}

/**
 * Converte uma tarefa (mod_assign) num evento oficial. Serve para enriquecer
 * eventos do calendário e para recuperar entregas que não tenham evento.
 */
export function normalizarTarefa(curso, tarefa, urlBase) {
  if (!tarefa || !tarefa.duedate) {
    return null;
  }

  const titulo = limparHtml(tarefa.name);

  if (!titulo) {
    return null;
  }

  const urlTarefa = tarefa.cmid
    ? urlDoMoodle(urlBase, `mod/assign/view.php?id=${tarefa.cmid}`)
    : null;

  return {
    id: `tarefa-${curso.id}-${tarefa.id}`,
    courseId: Number(curso.id),
    course: limparHtml(curso.fullname) || 'Sem cadeira',
    courseShort: limparHtml(curso.shortname) || '—',
    type: classificarTipoEvento({
      nome: tarefa.name,
      modulo: 'assign',
      descricao: tarefa.intro,
    }),
    title: titulo,
    date: new Date(Number(tarefa.duedate) * 1000).toISOString(),
    dateConfidence: 'exact',
    source: {
      kind: 'calendar',
      file: null,
      location: 'Tarefas do Moodle',
      snippet: resumirDescricao(tarefa.intro),
      url: urlSegura(urlTarefa),
    },
    status: 'confirmed',
    moodle: {
      eventType: 'due',
      module: 'assign',
      activity: titulo,
    },
  };
}

/**
 * Junta calendário e tarefas sem duplicar o mesmo prazo. Quando existe um evento
 * e uma tarefa para a mesma atividade, mantém o evento do calendário e usa a
 * descrição mais completa.
 */
export function combinarEventos(eventosCalendario, cursosComTarefas, urlBase) {
  const porChave = new Map();

  for (const evento of eventosCalendario) {
    porChave.set(chaveDoEvento(evento), evento);
  }

  for (const curso of cursosComTarefas) {
    for (const tarefa of curso.assignments || []) {
      const evento = normalizarTarefa(curso, tarefa, urlBase);

      if (!evento) {
        continue;
      }

      const chave = chaveDoEvento(evento);
      const existente = porChave.get(chave);

      if (!existente) {
        porChave.set(chave, evento);
        continue;
      }

      if ((evento.source.snippet || '').length > (existente.source.snippet || '').length) {
        existente.source.snippet = evento.source.snippet;
      }

      existente.source.url ||= evento.source.url;
    }
  }

  const limiteHistorico = Date.now() - DIAS_HISTORICO * 24 * 60 * 60 * 1000;
  const ids = new Set();

  return [...porChave.values()]
    .filter((evento) => {
      if (ids.has(evento.id) || new Date(evento.date).getTime() < limiteHistorico) {
        return false;
      }
      ids.add(evento.id);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.course.localeCompare(b.course));
}

/**
 * Recolhe tudo o que o dashboard precisa. Os pedidos são sequenciais; uma falha
 * isolada numa cadeira não impede a apresentação das restantes.
 */
export async function recolherDadosDashboard(cliente) {
  const siteInfo = await cliente.obterSiteInfo();
  const cursos = await cliente.listarCursos(siteInfo.userid);
  const cursosPorId = new Map(cursos.map((curso) => [Number(curso.id), curso]));
  const idsCursos = cursos.map((curso) => Number(curso.id));
  const avisos = [];
  let eventosCalendario = [];

  try {
    eventosCalendario = (await cliente.listarEventosDasCadeiras(idsCursos))
      .map((evento) => normalizarEventoCalendario(evento, cursosPorId))
      .filter(Boolean);
  } catch (erro) {
    if (erro.autenticacao) {
      throw erro;
    }

    // Moodle antigo pode não aceitar vários `courseids` de uma vez; nesse caso
    // volta-se ao pedido por cadeira, mantendo o aviso para o utilizador.
    avisos.push(
      `Não foi possível ler o calendário completo (${erro.message}). A tentar cadeira a cadeira.`,
    );

    for (const curso of cursos) {
      try {
        const eventos = await cliente.listarEventosDoCurso(curso.id);

        for (const evento of eventos) {
          const normalizado = normalizarEventoCalendario(evento, cursosPorId);
          if (normalizado) {
            eventosCalendario.push(normalizado);
          }
        }
      } catch (erroCurso) {
        if (erroCurso.autenticacao) {
          throw erroCurso;
        }
        avisos.push(
          `Não foi possível ler o calendário de ${curso.shortname || curso.fullname}: ${erroCurso.message}`,
        );
      }
    }
  }

  let cursosComTarefas = [];
  try {
    cursosComTarefas = await cliente.obterTarefas(idsCursos);
  } catch (erro) {
    if (erro.autenticacao) {
      throw erro;
    }
    avisos.push(`Não foi possível ler as tarefas do Moodle: ${erro.message}`);
  }

  const eventos = combinarEventos(eventosCalendario, cursosComTarefas, cliente.urlBase);
  const totaisPorCurso = new Map();

  for (const evento of eventos) {
    if (evento.courseId) {
      totaisPorCurso.set(
        evento.courseId,
        (totaisPorCurso.get(evento.courseId) || 0) + 1,
      );
    }
  }

  return {
    geradoEm: new Date().toISOString(),
    site: {
      nome: siteInfo.sitename || 'Moodle',
      utilizador: siteInfo.fullname || siteInfo.username || '',
      primeiroNome: siteInfo.firstname || siteInfo.username || '',
      release: siteInfo.release || null,
      url: cliente.urlBase,
    },
    cursos: cursos.map((curso) => ({
      id: Number(curso.id),
      nome: limparHtml(curso.fullname),
      curto: limparHtml(curso.shortname) || '—',
      total: totaisPorCurso.get(Number(curso.id)) || 0,
    })),
    eventos,
    avisos,
  };
}
