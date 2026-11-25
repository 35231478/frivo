/**
 * SOLICITAÇÕES ABRINDO SOZINHAS — a REGRA, pura (sem DOM, sem fetch, sem relógio de verdade).
 *
 * O que é: um chamado novo cai em "Solicitações" (portal do cliente ou QR Code) e quem está com o
 * Calendário aberto e OCIOSO vê o painel abrir sozinho. Nunca interrompe quem está no meio de uma
 * tarefa. Decisões fechadas com o dono:
 *   • abre para quem tem a permissão da gaveta (ordens › editar ou excluir) — não há "responsável";
 *   • ABRE o painel, não só pisca a aba;
 *   • ~60s entre conferências, só com a aba visível; ~20s de ociosidade; calibra-se depois de usar.
 *
 * "Novo" é COMPARAÇÃO, não contagem: guarda-se o `criadoEm` do chamado mais recente já visto e o
 * painel só abre quando chega um mais novo que esse. Um F5 não reabre o mesmo chamado. E o que já
 * estava pendente quando a pessoa abriu o calendário não é "novo": na primeira conferência o mais
 * recente vira a linha de base, sem abrir nada.
 *
 * "Ocioso" é regra explícita, TODAS valendo: aba visível; a gaveta já não está aberta; nenhum
 * diálogo/gaveta/balão aberto; nenhum arrasto em curso; nenhum filtro ativo; e sem toque no teclado
 * ou no ponteiro há OCIOSO_MS. Falhou uma, não abre — e não fica "devendo": tenta na próxima.
 *
 * O que lê o DOM e o relógio fica em components/calendario/vigia-solicitacoes.ts; o contador vem
 * de GET /api/solicitacoes/contador (um count e um max, nada mais).
 */

/** Quanto tempo entre uma conferência e outra (só com a aba visível). */
export const INTERVALO_VIGIA_MS = 60_000;
/** Sem toque no teclado ou no ponteiro por este tempo = ociosa. */
export const OCIOSO_MS = 20_000;
/** Onde o navegador guarda o `criadoEm` do chamado mais recente já visto. */
export const CHAVE_ULTIMO_VISTO = "frivo:solicitacoes:ultimo-visto";
/**
 * A linha de base quando a pessoa começou com a caixa VAZIA (nada pendente, logo nenhuma data para
 * guardar): um marco antes de qualquer chamado, para o primeiro que chegar ser novo. Sem isto o
 * primeiro chamado virava a própria linha de base e nunca abria nada.
 */
export const MARCO_ZERO = "1970-01-01T00:00:00.000Z";

/** O que o contador devolve. `maisRecenteEm` é ISO (o JSON do servidor), ou null sem pendência. */
export interface Contador {
  total: number;
  maisRecenteEm: string | null;
}

/** O estado da tela no momento da conferência. */
export interface EstadoDaTela {
  visivel: boolean;
  gavetaAberta: boolean;
  dialogoAberto: boolean;
  arrastando: boolean;
  filtroAtivo: boolean;
  /** Há quantos ms a pessoa tocou no teclado ou no ponteiro pela última vez */
  ultimaAcaoHa: number;
}

/** Chegou um chamado mais novo que o último visto? (sem pendência ou sem data, não) */
export function haNovo(c: Contador, ultimoVisto: string | null): boolean {
  if (!c.maisRecenteEm || c.total <= 0) return false;
  // ISO do mesmo formato compara em ordem como texto
  return !ultimoVisto || c.maisRecenteEm > ultimoVisto;
}

/** A pessoa está ociosa e nada na tela pede atenção? */
export function ociosa(e: EstadoDaTela): boolean {
  return e.visivel && !e.gavetaAberta && !e.dialogoAberto && !e.arrastando && !e.filtroAtivo && e.ultimaAcaoHa >= OCIOSO_MS;
}

/** A decisão: abrir sozinho só quando há chamado NOVO e a pessoa está OCIOSA. */
export function deveAbrirSozinha(c: Contador, ultimoVisto: string | null, e: EstadoDaTela): boolean {
  return haNovo(c, ultimoVisto) && ociosa(e);
}

/**
 * O que gravar como "último visto" depois de ver a gaveta: o maior `criadoEm` entre o que já estava
 * guardado e o que acabou de ser visto (nunca anda para trás).
 */
export function maisRecente(...datas: (string | null | undefined)[]): string | null {
  let m: string | null = null;
  for (const d of datas) if (d && (!m || d > m)) m = d;
  return m;
}
