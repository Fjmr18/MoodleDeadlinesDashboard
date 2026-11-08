const $ = (seletor) => document.querySelector(seletor);
const $$ = (seletor) => [...document.querySelectorAll(seletor)];

const MESES_LONGOS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_SEMANA_LONGOS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

const ROTULOS_TIPO = {
  teste: 'Teste',
  exame: 'Exame',
  entrega: 'Entrega',
  outro: 'Outro',
};

const ROTULOS_CONFIANCA = {
  exact: 'Data exata',
  'week-based': 'Calculada pela semana',
  unclear: 'Ano inferido',
};

const ROTULOS_REVISAO = {
  ativas: 'Ativas',
  'por-rever': 'Por rever',
  confirmadas: 'Confirmadas',
  descartados: 'Descartadas',
  todas: 'Todas',
};

const CORES_CADEIRAS = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#fb7185',
  '#22d3ee',
  '#c084fc',
  '#4ade80',
  '#f59e0b',
];

const CHAVE_TEMA = 'prazos-moodle-tema';

const ICONE_SOL = `
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round" />
`;

const ICONE_LUA = `
  <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z" stroke-linejoin="round" />
`;

const estado = {
  dados: null,
  carregando: true,
  atualizando: false,
  erro: null,
  tema: 'escuro',
  vista: 'lista',
  mes: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  ficheiros: null,
  analisandoFicheiros: false,
  filtros: {
    tipo: 'todos',
    curso: 'todos',
    pesquisa: '',
    mostrarPassados: false,
    dia: null,
    revisao: 'ativas',
  },
  revisaoAberta: null,
  revisaoEmCurso: false,
  configuracao: null,
  configuracaoPendente: false,
  configuracaoEmCurso: false,
};

let temporizadorToast = null;
let temporizadorFicheiros = null;
let estadoAnteriorFicheiros = null;
let dashboardIniciado = false;

function escapar(valor) {
  return String(valor ?? '').replace(
    /[&<>"']/g,
    (caractere) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[caractere],
  );
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function urlSegura(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function inicioDoDia(data = new Date()) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate());
}

function adicionarDias(data, dias) {
  const resultado = new Date(data);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

function chaveDia(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function dataDeChave(chave) {
  const [ano, mes, dia] = String(chave).split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

function diferencaEmDias(data) {
  return Math.round((inicioDoDia(data) - inicioDoDia(new Date())) / 86400000);
}

function pluralizar(numero, singular, plural) {
  return `${numero} ${numero === 1 ? singular : plural}`;
}

function corCadeira(evento) {
  const chave = String(evento.courseId ?? evento.courseShort ?? evento.course ?? '');
  let hash = 0;

  for (let indice = 0; indice < chave.length; indice += 1) {
    hash = (hash * 31 + chave.charCodeAt(indice)) >>> 0;
  }

  return CORES_CADEIRAS[hash % CORES_CADEIRAS.length];
}

function anoLetivo(data = new Date()) {
  const ano = data.getFullYear();
  return data.getMonth() >= 7 ? `${ano}/${ano + 1}` : `${ano - 1}/${ano}`;
}

function formatarHora(data) {
  return new Intl.DateTimeFormat('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}

function formatarDataLonga(data) {
  const diaSemana = DIAS_SEMANA_LONGOS[data.getDay()];
  return `${diaSemana}, ${data.getDate()} de ${MESES_LONGOS[data.getMonth()]} de ${data.getFullYear()}`;
}

function formatarDataCurta(data) {
  return `${data.getDate()} ${MESES_CURTOS[data.getMonth()]}`;
}

function valorDataHoraLocal(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  const hora = String(data.getHours()).padStart(2, '0');
  const minuto = String(data.getMinutes()).padStart(2, '0');
  return `${ano}-${mes}-${dia}T${hora}:${minuto}`;
}

function descreverConta(data) {
  const agora = new Date();
  const dias = diferencaEmDias(data);

  if (dias < 0) {
    const passados = Math.abs(dias);
    return passados === 1 ? 'Atrasado há 1 dia' : `Atrasado há ${passados} dias`;
  }

  if (dias === 0) {
    return data < agora ? 'Terminou hoje' : 'Termina hoje';
  }

  if (dias === 1) {
    return 'Amanhã';
  }

  if (dias <= 6) {
    return `Em ${dias} dias`;
  }

  if (dias <= 13) {
    return 'Na próxima semana';
  }

  return `Em ${Math.ceil(dias / 7)} semanas`;
}

function calcularUrgencia(data) {
  const agora = new Date();
  const dias = diferencaEmDias(data);

  if (data < agora || dias <= 1) {
    return 'urgente';
  }

  if (dias <= 6) {
    return 'breve';
  }

  return '';
}

function descreverAtualizacao(geradoEm) {
  const data = new Date(geradoEm);

  if (Number.isNaN(data.getTime())) {
    return '—';
  }

  const minutos = Math.floor((Date.now() - data.getTime()) / 60000);

  if (minutos < 1) {
    return 'agora mesmo';
  }

  if (minutos < 60) {
    return `há ${minutos} min`;
  }

  const horas = Math.floor(minutos / 60);

  if (horas < 24) {
    return `há ${horas} h`;
  }

  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

function temaPreferido() {
  try {
    const guardado = localStorage.getItem(CHAVE_TEMA);
    if (guardado === 'claro' || guardado === 'escuro') {
      return guardado;
    }
  } catch {
    // O armazenamento local pode estar indisponível; usa a preferência do sistema.
  }

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro';
}

function aplicarTema(tema) {
  estado.tema = tema;
  document.documentElement.dataset.tema = tema;
  const icone = $('#icone-tema');
  const botao = $('#botao-tema');

  if (icone) {
    icone.innerHTML = tema === 'escuro' ? ICONE_SOL : ICONE_LUA;
  }

  if (botao) {
    botao.setAttribute('aria-label', tema === 'escuro' ? 'Mudar para tema claro' : 'Mudar para tema escuro');
  }
}

function mostrarToast(mensagem, tipo = 'ok') {
  const toast = $('#toast');
  if (!toast) {
    return;
  }

  clearTimeout(temporizadorToast);
  toast.textContent = mensagem;
  toast.classList.toggle('erro', tipo === 'erro');
  toast.classList.add('visivel');
  temporizadorToast = setTimeout(() => toast.classList.remove('visivel'), 4200);
}

function urlBaseConfiguracao() {
  return String(estado.configuracao?.urlBase || 'https://moodle.unips.pt').replace(/\/+$/, '');
}

function urlConfiguracao(ano) {
  const valor = String(ano ?? '').trim();
  return valor ? `${urlBaseConfiguracao()}/${valor}/` : `${urlBaseConfiguracao()}/`;
}

function anoLetivoValido(valor) {
  if (!/^\d{4}$/.test(valor)) {
    return false;
  }

  const inicio = Number(valor.slice(0, 2));
  return Number(valor.slice(2)) === (inicio + 1) % 100;
}

function atualizarPrevisaoUrl() {
  const previsao = $('#config-url');
  if (previsao) {
    previsao.textContent = urlConfiguracao($('#config-ano')?.value);
  }
}

function mostrarErroConfiguracao(mensagem) {
  const caixa = $('#config-erro');
  if (!caixa) {
    return;
  }

  caixa.textContent = mensagem;
  caixa.hidden = false;
}

function limparErroConfiguracao() {
  const caixa = $('#config-erro');
  if (!caixa) {
    return;
  }

  caixa.textContent = '';
  caixa.hidden = true;
}

function mostrarAssistente(configuracao) {
  const dialogo = $('#configuracao');
  if (!dialogo) {
    return;
  }

  estado.configuracao = configuracao;
  estado.configuracaoPendente = true;
  dialogo.hidden = false;
  document.body.classList.add('configuracao-aberta');

  const ano = $('#config-ano');
  if (ano) {
    ano.value = configuracao.anoLetivoPorDefeito || '2627';
  }

  const semestre = $('#config-semestre');
  if (semestre) {
    semestre.value = configuracao.semestreInicioSugerido || '';
  }

  limparErroConfiguracao();
  atualizarPrevisaoUrl();
  atualizarEstadoLigacao();

  window.setTimeout(() => $('#config-numero')?.focus(), 60);
}

function esconderAssistente() {
  const dialogo = $('#configuracao');
  if (dialogo) {
    dialogo.hidden = true;
  }

  document.body.classList.remove('configuracao-aberta');
}

function iniciarDashboard() {
  if (dashboardIniciado) {
    return;
  }

  dashboardIniciado = true;
  carregarDados();
  carregarFicheiros();
}

async function verificarConfiguracao() {
  try {
    const resposta = await fetch('/api/setup', { headers: { Accept: 'application/json' } });
    const corpo = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(corpo.erro || `O servidor respondeu com HTTP ${resposta.status}.`);
    }

    estado.configuracao = corpo;

    if (corpo.pendente) {
      mostrarAssistente(corpo);
      return;
    }

    estado.configuracaoPendente = false;
    esconderAssistente();
    iniciarDashboard();
  } catch (erro) {
    // Sem a resposta de configuração tentamos na mesma abrir o dashboard; a
    // falha aparece no indicador de ligação e no toast.
    mostrarToast(erro.message || 'Não foi possível verificar a configuração.', 'erro');
    iniciarDashboard();
  }
}

async function submeterConfiguracao(evento) {
  evento.preventDefault();

  if (estado.configuracaoEmCurso) {
    return;
  }

  const ano = $('#config-ano')?.value.trim() || '';
  const numero = $('#config-numero')?.value.trim() || '';
  const password = $('#config-password')?.value || '';
  const semestre = $('#config-semestre')?.value || '';

  limparErroConfiguracao();

  if (!anoLetivoValido(ano)) {
    mostrarErroConfiguracao(
      'O ano letivo tem de ser um par consecutivo de quatro dígitos, por exemplo 2627.',
    );
    $('#config-ano')?.focus();
    return;
  }

  if (!numero) {
    mostrarErroConfiguracao('Indica o número de aluno.');
    $('#config-numero')?.focus();
    return;
  }

  if (!password) {
    mostrarErroConfiguracao('Indica a palavra-passe.');
    $('#config-password')?.focus();
    return;
  }

  const botao = $('#config-submit');
  const rotuloOriginal = botao?.textContent || 'Ligar ao Moodle';

  estado.configuracaoEmCurso = true;
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'A ligar ao Moodle…';
  }

  try {
    const resposta = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        anoLetivo: ano,
        numeroAluno: numero,
        password,
        semestreInicio: semestre || null,
      }),
    });
    const corpo = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      const mensagem = [corpo.erro, corpo.detalhe].filter(Boolean).join(' ');
      throw new Error(mensagem || `O servidor respondeu com HTTP ${resposta.status}.`);
    }

    estado.configuracaoPendente = false;
    estado.configuracao = { ...estado.configuracao, pendente: false };
    $('#config-password').value = '';
    esconderAssistente();
    mostrarToast(
      corpo.site ? `Ligado ao Moodle: ${corpo.site}.` : 'Ligação ao Moodle configurada.',
    );
    iniciarDashboard();
  } catch (erro) {
    mostrarErroConfiguracao(erro.message || 'Não foi possível concluir a configuração.');
  } finally {
    estado.configuracaoEmCurso = false;
    if (botao) {
      botao.disabled = false;
      botao.textContent = rotuloOriginal;
    }
  }
}

function atualizarDataHero() {
  const agora = new Date();
  $('#data-hoje').textContent = String(agora.getDate()).padStart(2, '0');
  $('#mes-hoje').textContent = MESES_LONGOS[agora.getMonth()];
  $('#ano-hoje').textContent = String(agora.getFullYear());
  $('#semestre').textContent = `Ano letivo ${anoLetivo(agora)}`;

  const hora = agora.getHours();
  $('#saudacao').textContent = hora < 12 ? 'Bom dia' : hora < 19 ? 'Boa tarde' : 'Boa noite';
}

function atualizarCabecalho() {
  const dados = estado.dados;
  atualizarDataHero();

  $('#nome-utilizador').textContent = dados?.site?.primeiroNome || 'estudante';
  $('#nome-site').textContent = dados?.site?.nome || 'Moodle';
  $('#rodape-moodle').textContent = dados?.site?.nome || 'Moodle';
}

function filtrarEventos({ incluirTipo = true, incluirDia = true } = {}) {
  const dados = estado.dados;

  if (!dados?.eventos?.length) {
    return [];
  }

  const filtros = estado.filtros;
  const inicioHoje = inicioDoDia();
  const busca = normalizarTexto(filtros.pesquisa);

  return dados.eventos
    .filter((evento) => {
      const data = new Date(evento.date);

      if (Number.isNaN(data.getTime())) {
        return false;
      }

      if (filtros.revisao === 'por-rever' && evento.status !== 'needs-review') {
        return false;
      }

      if (filtros.revisao === 'descartados' && evento.status !== 'dismissed') {
        return false;
      }

      if (
        filtros.revisao === 'confirmadas' &&
        !(evento.source?.kind === 'file' && evento.status === 'confirmed')
      ) {
        return false;
      }

      if (
        (filtros.revisao === 'ativas' || filtros.revisao === 'por-rever') &&
        evento.status === 'dismissed'
      ) {
        return false;
      }

      if (!filtros.mostrarPassados && data < inicioHoje) {
        return false;
      }

      if (filtros.curso !== 'todos' && String(evento.courseId) !== filtros.curso) {
        return false;
      }

      if (incluirTipo && filtros.tipo !== 'todos' && evento.type !== filtros.tipo) {
        return false;
      }

      if (incluirDia && filtros.dia && chaveDia(data) !== filtros.dia) {
        return false;
      }

      if (busca) {
        const alvo = normalizarTexto(
          [evento.title, evento.course, evento.courseShort, evento.source?.snippet]
            .filter(Boolean)
            .join(' '),
        );

        if (!alvo.includes(busca)) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.course.localeCompare(b.course));
}

function atualizarEstatisticas() {
  const dados = estado.dados;

  if (!dados) {
    return;
  }

  const inicioHoje = inicioDoDia();
  const fimSeteDias = adicionarDias(inicioHoje, 7);
  const eventos = dados.eventos
    .map((evento) => ({ evento, data: new Date(evento.date) }))
    .filter(
      ({ evento, data }) =>
        evento.status !== 'dismissed' && !Number.isNaN(data.getTime()),
    );

  const futuros = eventos.filter(({ data }) => data >= inicioHoje);
  const proximosSete = eventos.filter(({ data }) => data >= inicioHoje && data < fimSeteDias);
  const atrasados = eventos.filter(({ data }) => data < inicioHoje);
  const cursosComPrazos = new Set(futuros.map(({ evento }) => evento.courseId).filter(Boolean));
  const testes = proximosSete.filter(({ evento }) => evento.type === 'teste' || evento.type === 'exame').length;
  const entregas = proximosSete.filter(({ evento }) => evento.type === 'entrega').length;

  $('#stat-futuros').textContent = String(futuros.length);
  $('#stat-sete-dias').textContent = String(proximosSete.length);
  $('#stat-atrasados').textContent = String(atrasados.length);
  $('#stat-cadeiras').textContent = String(dados.cursos.length);

  $('#stat-futuros-extra').textContent = pluralizar(cursosComPrazos.size, 'cadeira com prazos', 'cadeiras com prazos');
  $('#stat-sete-dias-extra').textContent =
    testes + entregas === 0
      ? 'sem testes nem entregas'
      : [testes ? pluralizar(testes, 'teste', 'testes') : null, entregas ? pluralizar(entregas, 'entrega', 'entregas') : null]
          .filter(Boolean)
          .join(' · ');
  $('#stat-atrasados-extra').textContent = atrasados.length ? 'nos últimos 90 dias' : 'nada em atraso';
  $('#stat-cadeiras-extra').textContent = pluralizar(dados.cursos.length, 'inscrita', 'inscritas');
}

function atualizarSelecaoCurso() {
  const select = $('#filtro-curso');
  const dados = estado.dados;

  if (!select || !dados) {
    return;
  }

  const assinatura = dados.cursos.map((curso) => curso.id).join(',');
  if (select.dataset.assinatura !== assinatura) {
    select.innerHTML = [
      '<option value="todos">Todas as cadeiras</option>',
      ...dados.cursos.map(
        (curso) =>
          `<option value="${curso.id}">${escapar(curso.curto)} — ${escapar(curso.nome)}</option>`,
      ),
    ].join('');
    select.dataset.assinatura = assinatura;
  }

  const existe = [...select.options].some((opcao) => opcao.value === estado.filtros.curso);
  if (!existe) {
    estado.filtros.curso = 'todos';
  }
  select.value = estado.filtros.curso;
}

function atualizarListaCadeiras() {
  const lista = $('#lista-cadeiras');
  const dados = estado.dados;

  if (!lista || !dados) {
    return;
  }

  $('#total-cadeiras').textContent = String(dados.cursos.length);

  lista.innerHTML = dados.cursos
    .map((curso) => {
      const ativo = String(curso.id) === estado.filtros.curso;
      const cor = corCadeira(curso);
      return `
        <li>
          <button
            type="button"
            class="curso-botao${ativo ? ' esta-ativo' : ''}"
            data-curso="${curso.id}"
            style="--cor-cadeira: ${cor}"
            aria-pressed="${ativo}"
            title="${escapar(curso.nome)}"
          >
            <span class="curso-ponto" aria-hidden="true"></span>
            <span class="curso-texto">
              <span class="curso-nome">${escapar(curso.curto)}</span>
              <span class="curso-completo">${escapar(curso.nome)}</span>
            </span>
            <span class="curso-contagem">${curso.total}</span>
          </button>
        </li>
      `;
    })
    .join('');
}

function atualizarRevisao() {
  const dados = estado.dados;
  const revisao = dados?.revisao;
  const cartao = $('#cartao-revisao');
  const aviso = $('#aviso-revisao');
  const select = $('#filtro-revisao');

  if (!cartao || !aviso || !select) {
    return;
  }

  const porRever = Number(revisao?.porRever) || 0;
  const confirmadas = Number(revisao?.confirmadas) || 0;
  const descartadas = Number(revisao?.descartadas) || 0;
  const extraidas = Number(revisao?.extraidas) || 0;

  cartao.hidden = extraidas === 0;
  $('#revisao-total').textContent = String(extraidas);
  $('#revisao-por-rever').textContent = String(porRever);
  $('#revisao-confirmadas').textContent = String(confirmadas);
  $('#revisao-descartadas').textContent = String(descartadas);

  if (porRever > 0) {
    $('#aviso-revisao-texto').textContent =
      `${pluralizar(porRever, 'data extraída de ficheiros está', 'datas extraídas de ficheiros estão')} por confirmar.`;
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
  }

  if (select.value !== estado.filtros.revisao) {
    select.value = estado.filtros.revisao;
  }

  for (const botao of $$('[data-revisao]')) {
    const ativo = botao.dataset.revisao === estado.filtros.revisao;
    botao.classList.toggle('esta-ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  }
}

function atualizarContagensChips() {
  const eventos = filtrarEventos({ incluirTipo: false, incluirDia: false });
  const contagens = { todos: eventos.length, teste: 0, exame: 0, entrega: 0, outro: 0 };

  for (const evento of eventos) {
    if (contagens[evento.type] !== undefined) {
      contagens[evento.type] += 1;
    }
  }

  for (const botao of $$('.chip-tipo')) {
    const tipo = botao.dataset.tipo;
    const contagem = botao.querySelector('.chip-contagem');

    if (contagem) {
      contagem.textContent = String(contagens[tipo] ?? 0);
    }

    const ativo = estado.filtros.tipo === tipo;
    botao.classList.toggle('esta-ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  }
}

function atualizarBotoesVista() {
  for (const botao of $$('[data-vista]')) {
    const ativo = botao.dataset.vista === estado.vista;
    botao.classList.toggle('esta-ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  }

  $('#vista-lista').hidden = estado.vista !== 'lista';
  $('#vista-calendario').hidden = estado.vista !== 'calendario';
}

function atualizarFiltroDia() {
  const caixa = $('#filtro-dia');
  const filtros = estado.filtros;

  if (!filtros.dia) {
    caixa.hidden = true;
    return;
  }

  const data = dataDeChave(filtros.dia);
  $('#filtro-dia-texto').textContent = formatarDataLonga(data);
  caixa.hidden = false;
  $('#mostrar-passados').checked = filtros.mostrarPassados;
}

function atualizarAvisos() {
  const dados = estado.dados;
  const caixa = $('#aviso-cache');

  if (!dados) {
    caixa.hidden = true;
    return;
  }

  const avisos = [];
  if (dados.meta?.aviso) {
    avisos.push(dados.meta.aviso);
  }
  if (Array.isArray(dados.avisos) && dados.avisos.length > 0) {
    avisos.push(...dados.avisos);
  }

  if (avisos.length === 0) {
    caixa.hidden = true;
    return;
  }

  $('#aviso-cache-texto').textContent = avisos.join(' ');
  caixa.hidden = false;
}

function atualizarEstadoLigacao() {
  const indicador = $('#estado-ligacao');
  const texto = $('#estado-texto');
  const dados = estado.dados;

  let estadoLigacao = 'a-carregar';
  let rotulo = 'A ligar ao Moodle…';

  if (estado.configuracaoPendente) {
    estadoLigacao = 'configuracao';
    rotulo = 'Falta configurar';
  } else if (estado.erro && !dados) {
    estadoLigacao = 'erro';
    rotulo = 'Sem ligação';
  } else if (dados) {
    if (estado.atualizando) {
      rotulo = 'A atualizar…';
    } else if (
      (dados.meta?.origem === 'moodle' || dados.meta?.origem === 'memoria') &&
      !dados.meta?.aviso
    ) {
      estadoLigacao = 'ligado';
      rotulo = 'Ligado ao Moodle';
    } else {
      estadoLigacao = 'cache';
      rotulo = 'Dados em cache';
    }
  }

  indicador.dataset.estado = estadoLigacao;
  texto.textContent = rotulo;
}

function atualizarCartaoEstado() {
  const dados = estado.dados;
  const ponto = $('#ponto-estado');

  if (!dados) {
    $('#estado-origem').textContent = '—';
    $('#estado-gerado').textContent = '—';
    $('#estado-servidor').textContent = '—';
    $('#estado-eventos').textContent = '—';
    ponto.dataset.estado = estado.erro ? 'erro' : 'cache';
    return;
  }

  const origem = dados.meta?.origem;
  const origemTexto = {
    moodle: 'Moodle (agora)',
    memoria: 'Cache em memória',
    disco: 'Cache local',
    cache: 'Cache de segurança',
  }[origem] || 'Desconhecida';

  $('#estado-origem').textContent = origemTexto;
  $('#estado-gerado').textContent = descreverAtualizacao(dados.geradoEm);
  $('#estado-servidor').textContent = dados.site?.release
    ? `Moodle ${dados.site.release.split(' ')[0]}`
    : dados.site?.nome || 'Moodle';
  $('#estado-eventos').textContent = String(dados.eventos.length);
  ponto.dataset.estado =
    (origem === 'moodle' || origem === 'memoria') && !dados.meta?.aviso ? 'ligado' : 'cache';
}

function renderizarAcoesRevisao(evento) {
  const desativado = estado.revisaoEmCurso ? ' disabled' : '';
  const botoes = [];

  if (evento.status === 'dismissed') {
    botoes.push(
      `<button type="button" class="botao-revisao confirmar" data-revisao-acao="confirm" data-id="${escapar(evento.id)}"${desativado}>Recuperar</button>`,
    );
  } else {
    if (evento.status === 'needs-review') {
      botoes.push(
        `<button type="button" class="botao-revisao confirmar" data-revisao-acao="confirm" data-id="${escapar(evento.id)}"${desativado}>Confirmar</button>`,
      );
    }

    botoes.push(
      `<button type="button" class="botao-revisao" data-revisao-acao="correct" data-id="${escapar(evento.id)}"${desativado}>Corrigir</button>`,
      `<button type="button" class="botao-revisao descartar" data-revisao-acao="dismiss" data-id="${escapar(evento.id)}"${desativado}>Descartar</button>`,
    );
  }

  return `<div class="evento-revisao-acoes">${botoes.join('')}</div>`;
}

function renderizarFormularioRevisao(evento) {
  const data = new Date(evento.date);
  const original = evento.review?.originalDate
    ? new Date(evento.review.originalDate)
    : null;
  const nota =
    original && !Number.isNaN(original.getTime()) && original.getTime() !== data.getTime()
      ? `<p class="evento-revisao-nota">Sugestão original: ${escapar(formatarDataLonga(original))} às ${formatarHora(original)}</p>`
      : '';

  return `
    <form class="evento-revisao-form" data-form-revisao="${escapar(evento.id)}">
      ${nota}
      <div class="evento-revisao-campos">
        <label>
          <span>Data e hora</span>
          <input type="datetime-local" name="date" value="${valorDataHoraLocal(data)}" required />
        </label>
        <label class="campo-titulo-revisao">
          <span>Título</span>
          <input type="text" name="title" value="${escapar(evento.title)}" maxlength="160" />
        </label>
      </div>
      <div class="evento-revisao-form-acoes">
        <button type="submit" class="botao-revisao confirmar"${estado.revisaoEmCurso ? ' disabled' : ''}>Guardar correção</button>
        <button type="button" class="botao-revisao" data-revisao-acao="cancelar" data-id="${escapar(evento.id)}"${estado.revisaoEmCurso ? ' disabled' : ''}>Cancelar</button>
      </div>
    </form>
  `;
}

function renderizarEvento(evento) {
  const data = new Date(evento.date);
  const cor = corCadeira(evento);
  const urgencia = calcularUrgencia(data);
  const tipo = ROTULOS_TIPO[evento.type] || 'Outro';
  const descricao = evento.source?.snippet
    ? `<p class="evento-descricao">${escapar(evento.source.snippet)}</p>`
    : '';
  const url = urlSegura(evento.source?.url);
  const ligacao = url
    ? `<a class="evento-link" href="${escapar(url)}" target="_blank" rel="noopener noreferrer" title="Abrir no Moodle">Abrir no Moodle
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M7 17 17 7M9 7h8v8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </a>`
    : '';
  const ficheiro = evento.source?.kind === 'file';
  const descartado = evento.status === 'dismissed';
  const porRever = evento.status === 'needs-review';
  const confirmada = ficheiro && evento.status === 'confirmed';
  const confianca = ficheiro ? ROTULOS_CONFIANCA[evento.dateConfidence] : null;
  const etiquetaRevisao = porRever
    ? '<span class="etiqueta-revisao">Por rever</span>'
    : descartado
      ? '<span class="etiqueta-revisao etiqueta-descartado">Descartada</span>'
      : confirmada
        ? '<span class="etiqueta-revisao etiqueta-confirmada">Confirmada</span>'
        : '';
  const etiquetaConfianca = confianca
    ? `<span class="evento-confianca" title="Confiança da data sugerida">${escapar(confianca)}</span>`
    : '';
  const origemFicheiro = ficheiro
    ? `${evento.source?.file || 'Ficheiro'} · ${evento.source?.location || 'documento'}`
    : evento.source?.location || 'Moodle';
  const corrigida = Boolean(evento.review?.corrigida);
  const notaCorrecao = corrigida
    ? '<span class="evento-corrigida">Corrigida manualmente</span>'
    : '';
  const acoes = ficheiro ? renderizarAcoesRevisao(evento) : '';
  const formulario = estado.revisaoAberta === evento.id ? renderizarFormularioRevisao(evento) : '';

  return `
    <article
      class="evento${descartado ? ' evento-descartado' : ''}${porRever ? ' evento-por-rever' : ''}"
      data-tipo="${escapar(evento.type)}"
      data-urgencia="${urgencia}"
      style="--cor-cadeira: ${cor}"
      title="${escapar(evento.course)}"
    >
      <div class="evento-data" aria-hidden="true">
        <span class="evento-dia">${String(data.getDate()).padStart(2, '0')}</span>
        <span class="evento-mes">${MESES_CURTOS[data.getMonth()]}</span>
        <span class="evento-semana">${DIAS_SEMANA[data.getDay()]}</span>
      </div>
      <div class="evento-corpo">
        <div class="evento-meta">
          <span class="etiqueta-cadeira">
            <span class="ponto-cadeira" aria-hidden="true"></span>
            ${escapar(evento.courseShort || evento.course)}
          </span>
          <span class="etiqueta-tipo">${tipo}</span>
          ${etiquetaRevisao}
          ${etiquetaConfianca}
          ${notaCorrecao}
          <span class="evento-conta">${descreverConta(data)}</span>
        </div>
        <h3 class="evento-titulo">${escapar(evento.title)}</h3>
        ${descricao}
        <div class="evento-rodape">
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            ${formatarHora(data)}
          </span>
          <span class="evento-origem" title="${escapar(origemFicheiro)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="3" />
              <path d="M3 10h18M8 3v4M16 3v4" stroke-linecap="round" />
            </svg>
            ${escapar(origemFicheiro)}
          </span>
          ${ligacao}
        </div>
        ${acoes}
        ${formulario}
      </div>
    </article>
  `;
}

function agruparEventos(eventos) {
  const grupos = [
    { chave: 'atrasado', titulo: 'Atrasados', eventos: [] },
    { chave: 'hoje', titulo: 'Hoje', eventos: [] },
    { chave: 'amanha', titulo: 'Amanhã', eventos: [] },
    { chave: 'semana', titulo: 'Esta semana', eventos: [] },
    { chave: 'mais', titulo: 'Mais tarde', eventos: [] },
  ];

  for (const evento of eventos) {
    const dias = diferencaEmDias(new Date(evento.date));
    const grupo =
      dias < 0 ? grupos[0] : dias === 0 ? grupos[1] : dias === 1 ? grupos[2] : dias <= 6 ? grupos[3] : grupos[4];
    grupo.eventos.push(evento);
  }

  return grupos.filter((grupo) => grupo.eventos.length > 0);
}

function renderizarLista() {
  const lista = $('#lista-eventos');
  const eventos = filtrarEventos();

  if (eventos.length === 0) {
    const filtrosAtivos =
      estado.filtros.tipo !== 'todos' ||
      estado.filtros.curso !== 'todos' ||
      estado.filtros.pesquisa ||
      estado.filtros.dia ||
      estado.filtros.mostrarPassados ||
      estado.filtros.revisao !== 'ativas';

    const titulo =
      estado.filtros.revisao === 'por-rever'
        ? 'Não há datas por rever'
        : estado.filtros.revisao === 'confirmadas'
          ? 'Ainda não há datas confirmadas'
          : estado.filtros.revisao === 'descartados'
            ? 'Não há datas descartadas'
            : filtrosAtivos
              ? 'Nenhum prazo com estes filtros'
              : 'Ainda não há prazos para mostrar';
    const mensagem =
      estado.filtros.revisao === 'por-rever'
        ? 'Todas as datas extraídas dos ficheiros já foram confirmadas ou descartadas.'
        : estado.filtros.revisao === 'confirmadas'
          ? 'Confirma ou corrige uma sugestão na vista “Por rever” para a fixar aqui.'
          : estado.filtros.revisao === 'descartados'
            ? 'As sugestões que descartares ficam aqui e podem ser recuperadas.'
            : filtrosAtivos
              ? 'Experimenta mudar o tipo, a cadeira, a revisão ou a pesquisa. Os prazos antigos podem estar escondidos.'
              : 'Quando o Moodle tiver eventos ou entregas, eles aparecem aqui automaticamente.';

    const botao = filtrosAtivos
      ? '<button type="button" data-acao="limpar-filtros">Limpar filtros</button>'
      : '<button type="button" data-acao="atualizar">Atualizar dados</button>';

    lista.innerHTML = `
      <div class="estado-vazio">
        <span class="estado-vazio-icone" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="3" y="5" width="18" height="16" rx="4" />
            <path d="M3 10h18M8 3v4M16 3v4M9 15h6" stroke-linecap="round" />
          </svg>
        </span>
        <h2>${titulo}</h2>
        <p>${mensagem}</p>
        ${botao}
      </div>
    `;
    return;
  }

  const grupos = agruparEventos(eventos);

  lista.innerHTML = grupos
    .map((grupo) => {
      const dataGrupo =
        grupo.chave === 'hoje' || grupo.chave === 'amanha'
          ? formatarDataCurta(new Date(grupo.eventos[0].date))
          : '';

      return `
        <section class="grupo-evento${grupo.chave === 'atrasado' ? ' grupo-atrasado' : ''}">
          <header class="grupo-cabecalho">
            <h2>${grupo.titulo}${dataGrupo ? ` <span class="grupo-data">${dataGrupo}</span>` : ''}</h2>
            <span class="grupo-contagem">${grupo.eventos.length}</span>
            <span class="grupo-linha" aria-hidden="true"></span>
          </header>
          ${grupo.eventos.map(renderizarEvento).join('')}
        </section>
      `;
    })
    .join('');
}

function agruparPorDia(eventos) {
  const mapa = new Map();

  for (const evento of eventos) {
    const data = new Date(evento.date);
    const chave = chaveDia(data);
    const lista = mapa.get(chave) || [];
    lista.push(evento);
    mapa.set(chave, lista);
  }

  for (const lista of mapa.values()) {
    lista.sort((a, b) => a.date.localeCompare(b.date));
  }

  return mapa;
}

function celulasDoMes(ano, mes) {
  const primeiroDia = new Date(ano, mes, 1);
  const deslocamento = (primeiroDia.getDay() + 6) % 7;
  const inicio = adicionarDias(primeiroDia, -deslocamento);
  return Array.from({ length: 42 }, (_, indice) => adicionarDias(inicio, indice));
}

function renderizarMiniCalendario(eventos) {
  const mapa = agruparPorDia(eventos);
  const ano = estado.mes.getFullYear();
  const mes = estado.mes.getMonth();
  const hoje = inicioDoDia();
  const selecionado = estado.filtros.dia;

  $('#titulo-mini-mes').textContent = `${MESES_LONGOS[mes]} ${ano}`;

  $('#mini-calendario').innerHTML = celulasDoMes(ano, mes)
    .map((data) => {
      const chave = chaveDia(data);
      const eventosDia = mapa.get(chave) || [];
      const foraMes = data.getMonth() !== mes;
      const ehHoje = chave === chaveDia(hoje);
      const ehSelecionado = chave === selecionado;
      const pontos = eventosDia
        .slice(0, 3)
        .map((evento) => `<span class="ponto-mini" style="--cor-ponto: ${corCadeira(evento)}"></span>`)
        .join('');

      return `
        <button
          type="button"
          class="dia-mini${foraMes ? ' fora-mes' : ''}${ehHoje ? ' hoje' : ''}${ehSelecionado ? ' selecionado' : ''}"
          data-dia="${chave}"
          aria-label="${formatarDataLonga(data)}${eventosDia.length ? `, ${pluralizar(eventosDia.length, 'prazo', 'prazos')}` : ''}"
          ${ehSelecionado ? 'aria-current="date"' : ''}
        >
          ${data.getDate()}
          ${pontos ? `<span class="pontos" aria-hidden="true">${pontos}</span>` : ''}
        </button>
      `;
    })
    .join('');
}

function renderizarCalendarioCompleto(eventos) {
  const mapa = agruparPorDia(eventos);
  const ano = estado.mes.getFullYear();
  const mes = estado.mes.getMonth();
  const hoje = inicioDoDia();
  const selecionado = estado.filtros.dia;

  $('#titulo-calendario').textContent = `${MESES_LONGOS[mes]} ${ano}`;

  $('#calendario-completo').innerHTML = celulasDoMes(ano, mes)
    .map((data) => {
      const chave = chaveDia(data);
      const eventosDia = mapa.get(chave) || [];
      const foraMes = data.getMonth() !== mes;
      const ehHoje = chave === chaveDia(hoje);
      const ehSelecionado = chave === selecionado;
      const visiveis = eventosDia.slice(0, 3);
      const chips = visiveis
        .map(
          (evento) =>
            `<span class="chip-evento" style="--cor-evento: ${corCadeira(evento)}" title="${escapar(evento.title)}">${escapar(evento.title)}</span>`,
        )
        .join('');
      const restantes =
        eventosDia.length > visiveis.length
          ? `<span class="mais-eventos">+${eventosDia.length - visiveis.length} prazo(s)</span>`
          : '';

      return `
        <button
          type="button"
          class="dia-mes${foraMes ? ' fora-mes' : ''}${ehHoje ? ' hoje' : ''}${ehSelecionado ? ' selecionado' : ''}"
          data-dia="${chave}"
          aria-label="${formatarDataLonga(data)}${eventosDia.length ? `, ${pluralizar(eventosDia.length, 'prazo', 'prazos')}` : ''}"
        >
          <span class="numero-dia">${data.getDate()}</span>
          ${chips}
          ${restantes}
        </button>
      `;
    })
    .join('');
}

function atualizarCalendarios() {
  const eventos = filtrarEventos({ incluirTipo: true, incluirDia: false });
  renderizarMiniCalendario(eventos);
  renderizarCalendarioCompleto(eventos);
}

function renderizar() {
  atualizarCabecalho();
  atualizarBotoesVista();
  atualizarFiltroDia();
  atualizarAvisos();
  atualizarEstadoLigacao();
  atualizarRevisao();

  if (!estado.dados) {
    if (estado.erro) {
      $('#lista-eventos').innerHTML = `
        <div class="estado-erro">
          <span class="estado-erro-icone" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 8v5" stroke-linecap="round" />
              <circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none" />
              <path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke-linejoin="round" />
            </svg>
          </span>
          <h2>Não foi possível carregar os prazos</h2>
          <p>${escapar(estado.erro)}</p>
          <button type="button" data-acao="atualizar">Tentar novamente</button>
        </div>
      `;
    }
    atualizarCartaoEstado();
    return;
  }

  atualizarEstatisticas();
  atualizarSelecaoCurso();
  atualizarListaCadeiras();
  atualizarContagensChips();
  atualizarCalendarios();
  atualizarCartaoEstado();
  renderizarLista();
}

async function carregarDados({ forcar = false } = {}) {
  if (estado.atualizando) {
    return;
  }

  estado.atualizando = true;
  estado.erro = null;

  if (forcar) {
    $('#botao-atualizar').classList.add('a-carregar');
    $('#botao-atualizar').disabled = true;
  } else if (!estado.dados) {
    estado.carregando = true;
  }

  atualizarEstadoLigacao();

  try {
    const resposta = await fetch(forcar ? '/api/refresh' : '/api/events', {
      method: forcar ? 'POST' : 'GET',
      headers: { Accept: 'application/json' },
    });

    const corpo = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(corpo.erro || `O servidor respondeu com HTTP ${resposta.status}.`);
    }

    if (!Array.isArray(corpo.eventos)) {
      throw new Error('A resposta do servidor não tem a lista de eventos esperada.');
    }

    estado.dados = corpo;
    estado.erro = null;

    if (forcar) {
      mostrarToast('Dados atualizados a partir do Moodle.');
    }
  } catch (erro) {
    estado.erro = erro.message || 'Erro desconhecido.';

    if (forcar && estado.dados) {
      mostrarToast(`Não foi possível atualizar: ${estado.erro}`, 'erro');
    }
  } finally {
    estado.carregando = false;
    estado.atualizando = false;
    $('#botao-atualizar').classList.remove('a-carregar');
    $('#botao-atualizar').disabled = false;
    renderizar();
  }
}

function limparFiltros() {
  estado.filtros = {
    tipo: 'todos',
    curso: 'todos',
    pesquisa: '',
    mostrarPassados: false,
    dia: null,
    revisao: 'ativas',
  };

  $('#pesquisa').value = '';
  $('#filtro-curso').value = 'todos';
  $('#filtro-revisao').value = 'ativas';
  $('#mostrar-passados').checked = false;
  renderizar();
}

function selecionarDia(data) {
  estado.filtros.dia = chaveDia(data);
  estado.mes = new Date(data.getFullYear(), data.getMonth(), 1);

  if (data < inicioDoDia()) {
    estado.filtros.mostrarPassados = true;
    $('#mostrar-passados').checked = true;
  }

  if (estado.vista !== 'lista') {
    estado.vista = 'lista';
  }

  renderizar();
}

function mudarMes(delta) {
  estado.filtros.dia = null;
  estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + delta, 1);
  renderizar();
}

const ROTULOS_ESTADO_FICHEIRO = {
  extraido: 'Texto extraído',
  'sem-texto': 'Sem texto',
  ignorado: 'Ignorado',
  erro: 'Erro',
  pendente: 'Em espera',
};

function formatarBytes(bytes) {
  const valor = Number(bytes);
  if (!Number.isFinite(valor) || valor <= 0) {
    return '0 B';
  }

  const unidades = ['B', 'KB', 'MB', 'GB'];
  let quantidade = valor;
  let indice = 0;

  while (quantidade >= 1024 && indice < unidades.length - 1) {
    quantidade /= 1024;
    indice += 1;
  }

  const casas = indice === 0 ? 0 : 1;
  return `${quantidade.toFixed(casas).replace('.', ',')} ${unidades[indice]}`;
}

function formatarNumero(valor) {
  return new Intl.NumberFormat('pt-PT').format(Number(valor) || 0);
}

function descreverProgressoFicheiros(dados) {
  const progresso = dados?.progresso || {};
  const ficheiros = Number(progresso.ficheiros) || 0;
  const totalFicheiros = Number(progresso.totalFicheiros) || 0;
  const cursos = Number(progresso.cursos) || 0;
  const totalCursos = Number(progresso.totalCursos) || 0;

  if (totalFicheiros > 0) {
    const atual = Math.min(Math.max(ficheiros, 1), totalFicheiros);
    const parte = `Ficheiro ${atual} de ${totalFicheiros}`;
    return `${parte} · cadeira ${Math.min(cursos + 1, totalCursos)} de ${totalCursos}`;
  }

  if (totalCursos > 0) {
    return `A listar as cadeiras (${cursos} de ${totalCursos})…`;
  }

  return 'A preparar a análise…';
}

function calcularProgressoFicheiros(dados) {
  const progresso = dados?.progresso || {};
  const totalFicheiros = Number(progresso.totalFicheiros) || 0;
  const ficheiros = Number(progresso.ficheiros) || 0;

  if (totalFicheiros > 0) {
    return Math.min(100, Math.round((ficheiros / totalFicheiros) * 100));
  }

  const totalCursos = Number(progresso.totalCursos) || 0;
  const cursos = Number(progresso.cursos) || 0;

  if (totalCursos > 0) {
    return Math.min(100, Math.round((cursos / totalCursos) * 100));
  }

  return 0;
}

function atualizarResumoFicheiros(dados) {
  const caixa = $('#ficheiros-resumo');
  const resumo = dados?.resumo;

  if (!resumo || !dados?.ficheiros?.length) {
    caixa.innerHTML = '';
    caixa.hidden = true;
    return;
  }

  caixa.hidden = false;
  caixa.innerHTML = `
    <article class="ficheiros-estatistica">
      <span class="ficheiros-estatistica-valor">${formatarNumero(resumo.extraidos)}</span>
      <span class="ficheiros-estatistica-rotulo">Com texto extraído</span>
      <span class="ficheiros-estatistica-nota">de ${formatarNumero(resumo.ficheiros)} ficheiros</span>
    </article>
    <article class="ficheiros-estatistica">
      <span class="ficheiros-estatistica-valor">${formatarNumero(resumo.caracteres)}</span>
      <span class="ficheiros-estatistica-rotulo">Caracteres</span>
      <span class="ficheiros-estatistica-nota">texto extraído</span>
    </article>
    <article class="ficheiros-estatistica">
      <span class="ficheiros-estatistica-valor">${formatarNumero(resumo.ignorados)}</span>
      <span class="ficheiros-estatistica-rotulo">Ignorados</span>
      <span class="ficheiros-estatistica-nota">limites ou ficheiros vazios</span>
    </article>
    <article class="ficheiros-estatistica">
      <span class="ficheiros-estatistica-valor">${formatarNumero(resumo.erros)}</span>
      <span class="ficheiros-estatistica-rotulo">Erros</span>
      <span class="ficheiros-estatistica-nota">${formatarBytes(resumo.bytesDescarregados)} descarregados</span>
    </article>
  `;
}

function agruparFicheirosPorCurso(ficheiros) {
  const grupos = new Map();

  for (const ficheiro of ficheiros) {
    const chave = String(ficheiro.cursoId ?? ficheiro.curso ?? '');
    const grupo = grupos.get(chave) || {
      cursoId: ficheiro.cursoId,
      curso: ficheiro.curso,
      cursoCurto: ficheiro.cursoCurto,
      ficheiros: [],
    };

    grupo.ficheiros.push(ficheiro);
    grupos.set(chave, grupo);
  }

  return [...grupos.values()].sort((a, b) =>
    String(a.cursoCurto || a.curso).localeCompare(String(b.cursoCurto || b.curso), 'pt'),
  );
}

function renderizarFicheiro(ficheiro) {
  const estadoFicheiro = ficheiro.estado || 'pendente';
  const rotulo = ROTULOS_ESTADO_FICHEIRO[estadoFicheiro] || estadoFicheiro;
  const detalhes = [];

  if (estadoFicheiro === 'extraido' || estadoFicheiro === 'sem-texto') {
    if (ficheiro.paginas) {
      detalhes.push(`${formatarNumero(ficheiro.paginas)} ${ficheiro.paginas === 1 ? 'página' : 'páginas'}`);
    }
    detalhes.push(`${formatarNumero(ficheiro.caracteres)} caracteres`);
  }

  if (ficheiro.tamanho) {
    detalhes.push(formatarBytes(ficheiro.tamanho));
  }

  const aviso = ficheiro.motivo || ficheiro.avisos?.[0];

  return `
    <li class="ficheiro estado-${escapar(estadoFicheiro)}">
      <span class="ficheiro-tipo">${escapar((ficheiro.extensao || '?').toUpperCase())}</span>
      <span class="ficheiro-info">
        <span class="ficheiro-nome" title="${escapar(ficheiro.nome)}">${escapar(ficheiro.nome)}</span>
        <span class="ficheiro-meta">${escapar(detalhes.join(' · '))}</span>
        ${
          aviso
            ? `<span class="ficheiro-aviso">${escapar(aviso)}</span>`
            : ''
        }
      </span>
      <span class="ficheiro-estado" title="${escapar(ficheiro.local || '')}">${escapar(rotulo)}</span>
    </li>
  `;
}

function renderizarListaFicheiros(dados) {
  const lista = $('#ficheiros-lista');
  const ficheiros = dados?.ficheiros || [];
  const avisos = (dados?.avisos || [])
    .map((aviso) => `<p class="ficheiros-aviso">${escapar(aviso)}</p>`)
    .join('');

  if (dados?.erro) {
    lista.innerHTML = `<p class="ficheiros-erro">${escapar(dados.erro)}</p>${avisos}`;
    return;
  }

  if (!ficheiros.length) {
    lista.innerHTML = `
      <p class="ficheiros-vazio">
        Ainda não foram analisados ficheiros. Usa “Analisar ficheiros” para descarregar os
        documentos das cadeiras.
      </p>
      ${avisos}
    `;
    return;
  }

  const grupos = agruparFicheirosPorCurso(ficheiros)
    .map((grupo) => {
      const extraidos = grupo.ficheiros.filter((item) => item.estado === 'extraido').length;
      const cor = corCadeira({ courseId: grupo.cursoId, courseShort: grupo.cursoCurto });

      return `
        <section class="ficheiros-grupo">
          <header class="ficheiros-grupo-topo">
            <span class="curso-ponto" style="--cor-cadeira: ${cor}" aria-hidden="true"></span>
            <h3 title="${escapar(grupo.curso)}">${escapar(grupo.cursoCurto || grupo.curso)}</h3>
            <span class="ficheiros-grupo-nome">${escapar(grupo.curso)}</span>
            <span class="ficheiros-grupo-contagem">${extraidos}/${grupo.ficheiros.length}</span>
          </header>
          <ul class="ficheiros-itens">
            ${grupo.ficheiros.map(renderizarFicheiro).join('')}
          </ul>
        </section>
      `;
    })
    .join('');

  lista.innerHTML = avisos + grupos;
}

function atualizarFicheiros() {
  const dados = estado.ficheiros;
  const botao = $('#botao-analisar-ficheiros');
  const emCurso = estado.analisandoFicheiros || dados?.estado === 'a-analisar';

  if (botao) {
    botao.disabled = emCurso;
    botao.classList.toggle('a-carregar', emCurso);
  }

  const progresso = $('#ficheiros-progresso');

  if (progresso) {
    if (dados?.estado === 'a-analisar') {
      const percentagem = calcularProgressoFicheiros(dados);
      progresso.hidden = false;
      $('#barra-progresso-valor').style.width = `${percentagem}%`;
      $('#ficheiros-progresso-texto').textContent = descreverProgressoFicheiros(dados);
      progresso
        .querySelector('[role="progressbar"]')
        ?.setAttribute('aria-valuenow', String(percentagem));
    } else {
      progresso.hidden = true;
    }
  }

  atualizarResumoFicheiros(dados);
  renderizarListaFicheiros(dados);
}

function agendarConsultaFicheiros() {
  clearTimeout(temporizadorFicheiros);
  temporizadorFicheiros = setTimeout(() => {
    void carregarFicheiros();
  }, 1200);
}

async function carregarFicheiros() {
  try {
    const resposta = await fetch('/api/files', { headers: { Accept: 'application/json' } });
    const corpo = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(corpo.erro || `O servidor respondeu com HTTP ${resposta.status}.`);
    }

    const eraAnalise = estadoAnteriorFicheiros === 'a-analisar';
    estado.ficheiros = corpo;
    estadoAnteriorFicheiros = corpo.estado;
    atualizarFicheiros();

    if (corpo.estado === 'a-analisar') {
      agendarConsultaFicheiros();
    } else if (eraAnalise && corpo.estado === 'concluido') {
      mostrarToast(
        `Análise concluída: ${formatarNumero(corpo.resumo?.extraidos)} ficheiro(s) com texto.`,
      );
    }
  } catch (erro) {
    if (estado.ficheiros?.estado === 'a-analisar') {
      // Falha transitória durante a análise: tenta outra vez sem interromper.
      agendarConsultaFicheiros();
    } else {
      mostrarToast(erro.message || 'Não foi possível consultar os ficheiros.', 'erro');
    }
  }
}

async function iniciarAnaliseFicheiros() {
  if (estado.analisandoFicheiros || estado.ficheiros?.estado === 'a-analisar') {
    return;
  }

  estado.analisandoFicheiros = true;
  atualizarFicheiros();

  try {
    const resposta = await fetch('/api/files/scan', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const corpo = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(corpo.erro || `O servidor respondeu com HTTP ${resposta.status}.`);
    }

    estado.ficheiros = corpo;
    estadoAnteriorFicheiros = corpo.estado;
    mostrarToast('Análise de ficheiros iniciada.');
    agendarConsultaFicheiros();
  } catch (erro) {
    mostrarToast(erro.message || 'Não foi possível iniciar a análise.', 'erro');
  } finally {
    estado.analisandoFicheiros = false;
    atualizarFicheiros();
  }
}

async function enviarRevisao(id, acao, extra = {}) {
  if (estado.revisaoEmCurso) {
    return;
  }

  estado.revisaoEmCurso = true;
  renderizar();
  let sucesso = false;

  try {
    const resposta = await fetch('/api/review', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, action: acao, ...extra }),
    });
    const corpo = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(corpo.erro || `O servidor respondeu com HTTP ${resposta.status}.`);
    }

    if (!Array.isArray(corpo.eventos)) {
      throw new Error('A resposta do servidor não tem a lista de eventos esperada.');
    }

    estado.dados = corpo;
    estado.erro = null;
    sucesso = true;

    const mensagem = {
      confirm: acao === 'dismiss' ? 'Data recuperada.' : 'Data confirmada.',
      correct: 'Data corrigida.',
      dismiss: 'Data descartada.',
    }[acao];
    mostrarToast(mensagem || 'Revisão guardada.');
  } catch (erro) {
    mostrarToast(erro.message || 'Não foi possível guardar a revisão.', 'erro');
  } finally {
    estado.revisaoEmCurso = false;

    if (sucesso) {
      estado.revisaoAberta = null;
    }

    renderizar();
  }
}

function abrirCorrecao(id) {
  estado.revisaoAberta = estado.revisaoAberta === id ? null : id;
  renderizar();

  if (estado.revisaoAberta) {
    document
      .querySelector(`[data-form-revisao="${CSS.escape(estado.revisaoAberta)}"] input[name="date"]`)
      ?.focus();
  }
}

async function guardarCorrecao(form) {
  const id = form.dataset.formRevisao;
  const campos = new FormData(form);
  const valor = campos.get('date');
  const data = new Date(valor);

  if (!valor || Number.isNaN(data.getTime())) {
    mostrarToast('Indica uma data e hora válidas.', 'erro');
    return;
  }

  await enviarRevisao(id, 'correct', {
    date: data.toISOString(),
    title: String(campos.get('title') || '').trim(),
  });
}

function ligarEventos() {
  for (const botao of $$('.chip-tipo')) {
    botao.addEventListener('click', () => {
      estado.filtros.tipo = botao.dataset.tipo;
      renderizar();
    });
  }

  for (const botao of $$('[data-vista]')) {
    botao.addEventListener('click', () => {
      estado.vista = botao.dataset.vista;
      renderizar();
    });
  }

  $('#pesquisa').addEventListener('input', (evento) => {
    estado.filtros.pesquisa = evento.target.value.trim();
    renderizar();
  });

  $('#filtro-curso').addEventListener('change', (evento) => {
    estado.filtros.curso = evento.target.value;
    renderizar();
  });

  $('#filtro-revisao').addEventListener('change', (evento) => {
    estado.filtros.revisao = evento.target.value;
    renderizar();
  });

  $('#mostrar-passados').addEventListener('change', (evento) => {
    estado.filtros.mostrarPassados = evento.target.checked;

    if (!estado.filtros.mostrarPassados && estado.filtros.dia) {
      const data = dataDeChave(estado.filtros.dia);
      if (data < inicioDoDia()) {
        estado.filtros.dia = null;
      }
    }

    renderizar();
  });

  $('#botao-atualizar').addEventListener('click', () => carregarDados({ forcar: true }));
  $('#aviso-cache-atualizar').addEventListener('click', () => carregarDados({ forcar: true }));
  $('#botao-analisar-ficheiros').addEventListener('click', () => iniciarAnaliseFicheiros());
  $('#config-ano').addEventListener('input', atualizarPrevisaoUrl);
  $('#form-configuracao').addEventListener('submit', (evento) => {
    void submeterConfiguracao(evento);
  });

  $('#botao-tema').addEventListener('click', () => {
    const novoTema = estado.tema === 'escuro' ? 'claro' : 'escuro';
    aplicarTema(novoTema);

    try {
      localStorage.setItem(CHAVE_TEMA, novoTema);
    } catch {
      // Sem armazenamento local, o tema muda apenas nesta sessão.
    }
  });

  $('#mes-anterior').addEventListener('click', () => mudarMes(-1));
  $('#mes-seguinte').addEventListener('click', () => mudarMes(1));
  $('#calendario-anterior').addEventListener('click', () => mudarMes(-1));
  $('#calendario-seguinte').addEventListener('click', () => mudarMes(1));

  $('#calendario-hoje').addEventListener('click', () => {
    const agora = new Date();
    estado.filtros.dia = null;
    estado.mes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    renderizar();
  });

  $('#limpar-filtro-dia').addEventListener('click', () => {
    estado.filtros.dia = null;
    renderizar();
  });

  document.addEventListener('submit', (evento) => {
    const formulario = evento.target.closest?.('[data-form-revisao]');

    if (!formulario) {
      return;
    }

    evento.preventDefault();
    void guardarCorrecao(formulario);
  });

  document.addEventListener('click', (evento) => {
    const alvo = evento.target instanceof Element ? evento.target : null;

    if (!alvo) {
      return;
    }

    const acaoRevisao = alvo.closest('[data-revisao-acao]');
    if (acaoRevisao) {
      const acao = acaoRevisao.dataset.revisaoAcao;
      const id = acaoRevisao.dataset.id;

      if (acao === 'correct') {
        abrirCorrecao(id);
      } else if (acao === 'cancelar') {
        estado.revisaoAberta = null;
        renderizar();
      } else if (acao === 'confirm' || acao === 'dismiss') {
        void enviarRevisao(id, acao);
      }
      return;
    }

    const filtroRevisao = alvo.closest('[data-revisao]');
    if (filtroRevisao && ROTULOS_REVISAO[filtroRevisao.dataset.revisao]) {
      estado.filtros.revisao = filtroRevisao.dataset.revisao;
      renderizar();
      return;
    }

    const acao = alvo.closest('[data-acao]');
    if (acao) {
      if (acao.dataset.acao === 'limpar-filtros') {
        limparFiltros();
      } else if (acao.dataset.acao === 'atualizar') {
        carregarDados({ forcar: true });
      }
      return;
    }

    const curso = alvo.closest('[data-curso]');
    if (curso) {
      const id = curso.dataset.curso;
      estado.filtros.curso = estado.filtros.curso === id ? 'todos' : id;
      renderizar();
      return;
    }

    const dia = alvo.closest('[data-dia]');
    if (dia) {
      selecionarDia(dataDeChave(dia.dataset.dia));
    }
  });
}

function iniciar() {
  aplicarTema(temaPreferido());
  atualizarDataHero();
  ligarEventos();
  void verificarConfiguracao();

  // Mantém “Hoje”, contagens e estados relativos corretos sem recarregar a página.
  setInterval(() => {
    if (
      estado.dados &&
      !estado.atualizando &&
      !estado.erro &&
      !estado.revisaoAberta &&
      !estado.revisaoEmCurso
    ) {
      renderizar();
    }
  }, 60_000);
}

iniciar();
