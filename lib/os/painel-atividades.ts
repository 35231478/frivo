/**
 * O PAINEL DE ATIVIDADES da OS — regras puras (sem React, sem banco).
 *
 * O painel mostra cada atividade com o estado, a data/hora agendada, quem executa e a observação
 * curta. Para ler "o dia da OS" de relance, a ordem é a do CALENDÁRIO: pela data agendada, as sem
 * data no fim (ainda falta marcar) e as canceladas por último (não contam mais). Empate: a ordem
 * de criação, que é a que a lista sempre teve.
 */

export interface AtividadeDoPainel {
  id: string;
  status: string;
  dataAgendada: Date | string | null | undefined;
  /** Desempate: a ordem de criação (ISO ou Date); sem ela, a posição na lista */
  criadoEm?: Date | string | null;
}

const instante = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const n = new Date(d).getTime();
  return Number.isNaN(n) ? null : n;
};

/** Pela data agendada; sem data no fim; canceladas por último; empate pela criação (estável) */
export function ordenarParaPainel<T extends AtividadeDoPainel>(atividades: T[]): T[] {
  return atividades
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const cx = x.a.status === "CANCELADA" ? 1 : 0, cy = y.a.status === "CANCELADA" ? 1 : 0;
      if (cx !== cy) return cx - cy;
      const dx = instante(x.a.dataAgendada), dy = instante(y.a.dataAgendada);
      if (dx !== null && dy !== null && dx !== dy) return dx - dy;
      if ((dx === null) !== (dy === null)) return dx === null ? 1 : -1;
      const kx = instante(x.a.criadoEm), ky = instante(y.a.criadoEm);
      if (kx !== null && ky !== null && kx !== ky) return kx - ky;
      return x.i - y.i;
    })
    .map((x) => x.a);
}

export const OBSERVACAO_CURTA_MAX = 90;

/**
 * A observação em UMA linha curta: só a primeira linha, espaços juntados, cortada numa palavra
 * inteira com reticências. Vazia ou só espaços = null (o painel não mostra a linha).
 */
export function observacaoCurta(texto: string | null | undefined, max = OBSERVACAO_CURTA_MAX): string | null {
  if (!texto) return null;
  const linha = texto.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!linha) return null;
  const limpa = linha.replace(/\s+/g, " ");
  if (limpa.length <= max) return limpa;
  const corte = limpa.lastIndexOf(" ", max);
  return `${limpa.slice(0, corte > max / 2 ? corte : max).trimEnd()}…`;
}

export interface ResumoDoPainel {
  /** Atividades que contam (sem as canceladas) */
  total: number;
  concluidas: number;
  /** "2 de 4 concluídas" · "1 atividade" · "Nenhuma atividade" */
  texto: string;
}

/** O que o título do painel diz: quantas atividades contam e quantas já terminaram */
export function resumoDoPainel(atividades: { status: string }[]): ResumoDoPainel {
  const ativas = atividades.filter((a) => a.status !== "CANCELADA");
  const concluidas = ativas.filter((a) => a.status === "CONCLUIDA").length;
  const total = ativas.length;
  const texto = total === 0 ? "Nenhuma atividade"
    : concluidas === 0 ? (total === 1 ? "1 atividade" : `${total} atividades`)
    : `${concluidas} de ${total} concluída${total > 1 ? "s" : ""}`;
  return { total, concluidas, texto };
}
