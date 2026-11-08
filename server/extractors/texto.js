const ENTIDADES_XML = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * Descodifica as entidades usadas em XML do Office (`&amp;`, `&#233;`,
 * `&#x00E9;`). Entidades desconhecidas ficam como estão para não perder texto.
 */
export function descodificarEntidades(texto) {
  return String(texto ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (original, corpo) => {
    if (corpo.startsWith('#x') || corpo.startsWith('#X')) {
      const codigo = Number.parseInt(corpo.slice(2), 16);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : original;
    }

    if (corpo.startsWith('#')) {
      const codigo = Number.parseInt(corpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : original;
    }

    return ENTIDADES_XML[corpo.toLowerCase()] ?? original;
  });
}

/**
 * Normaliza texto extraído de slides ou PDFs: uniformiza quebras de linha,
 * colapsa espaços repetidos e remove linhas vazias consecutivas.
 */
export function normalizarTextoExtraido(texto) {
  const linhas = String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((linha) =>
      linha
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ +([,.;:!?%)\]])/g, '$1')
        .replace(/([(\[{]) +/g, '$1')
        .trim(),
    );

  const resultado = [];

  for (const linha of linhas) {
    if (linha === '' && (resultado.length === 0 || resultado.at(-1) === '')) {
      continue;
    }
    resultado.push(linha);
  }

  while (resultado.at(-1) === '') {
    resultado.pop();
  }

  return resultado.join('\n');
}
