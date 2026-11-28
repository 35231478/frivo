/**
 * DESEMPENHO — FECHAMENTO do mês, as regras (sem banco e sem tela).
 *
 * Fechar o mês transforma o que era projeção em DEFINITIVO: o painel do mês é guardado como estava
 * (escore, faixa, valor do bônus de cada colaborador) e dado novo não muda mais nada. Só se fecha um
 * mês que já terminou. Reabrir é exceção, com motivo, e fica registrado.
 *
 * AQUI SÓ SE REGISTRA O VALOR do bônus. Pagamento, imposto e encargo são do financeiro.
 */
import { z } from "zod";
import { COMPETENCIA_RE, competenciaCurta } from "./regras";
import type { GrupoRanking, Painel, PremiacaoNaTela } from "./painel";

/** O painel guardado no fechamento: o ranking com valores + as premiações do mês como eram */
export interface PainelCongelado extends Painel { premiacoes: PremiacaoNaTela[] }

export const MSG_MES_FECHADO = (competencia: string) => `O mês ${competenciaCurta(competencia)} está fechado. Reabra o mês para mudar.`;
export const MSG_JA_FECHADO = "Este mês já está fechado.";
export const MSG_FUTURO = "Este mês ainda não começou.";
export const AVISO_PENDENTES = (n: number) =>
  `${n === 1 ? "Há 1 item a revisar" : `Há ${n} itens a revisar`} neste mês. Sem revisão, ${n === 1 ? "ele não pesa" : "eles não pesam"} no escore fechado.`;
export const AVISO_MES_EM_ANDAMENTO = "O mês ainda não terminou. O que acontecer depois do fechamento não entra no escore nem no bônus.";
export const MSG_CONFIRMAR = "Confirme os avisos para fechar o mês.";
export const MSG_NADA_A_FECHAR = "Nenhum colaborador participa do Desempenho: não há o que fechar.";

/**
 * O que a gestão precisa saber (e confirmar) antes de fechar: itens ainda sem revisão no mês e mês
 * que ainda não terminou. Nenhum dos dois impede o fechamento — mas ninguém fecha sem ver.
 */
export function avisosDoFechamento(competencia: string, atual: string, pendentes: number): string[] {
  return [...(competencia === atual ? [AVISO_MES_EM_ANDAMENTO] : []), ...(pendentes > 0 ? [AVISO_PENDENTES(pendentes)] : [])];
}

/* ───────── a folha de bônus ───────── */

export interface LinhaFolha {
  tecnicoId: string | null; nome: string; perfil: string; posicao: number | null; escore: number | null; faixa: string | null; valor: number;
  /** COM-1: o usuário das comissões e a soma delas no mês (empresa sem comissão: ausente/zero) */
  usuarioId?: string | null;
  comissao?: number;
  /** COM-1: a conta a pagar gerada ao fechar (bônus + comissão) */
  contaPagarId?: string | null;
}
export interface Folha {
  linhas: LinhaFolha[];
  /** Soma dos bônus */
  total: number;
  /** COM-1: soma das comissões (ausente/zero sem comissão) */
  totalComissao?: number;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** A folha do mês: uma linha por colaborador, na ordem do painel (perfil e posição). Valor zero para quem não tem faixa. */
export function folhaDoPainel(painel: Pick<Painel, "grupos">): Folha {
  const linhas: LinhaFolha[] = painel.grupos.flatMap((g) => g.linhas.map((l) => ({
    tecnicoId: l.tecnicoId, nome: l.nome, perfil: g.perfil.nome, posicao: l.posicao, escore: l.escore, faixa: l.faixa, valor: centavos(l.bonus ?? 0),
  })));
  return { linhas, total: centavos(linhas.reduce((s, l) => s + l.valor, 0)) };
}

/** Perfil mostrado na linha de quem só tem comissão (não participa do Desempenho) */
export const PERFIL_SO_COMISSAO = "Comissão";

/**
 * COM-1 — a folha do mês com as comissões: quem já está na folha de bônus (mesmo colaborador) ganha a comissão
 * na mesma linha (UMA conta a pagar por pessoa); quem só tem comissão entra numa linha própria, no fim.
 */
export function folhaComComissoes(folha: Folha, pessoas: readonly { usuarioId: string; nome: string; tecnicoId: string | null; valor: number }[]): Folha {
  const linhas: LinhaFolha[] = folha.linhas.map((l) => ({ ...l, usuarioId: l.usuarioId ?? null, comissao: l.comissao ?? 0 }));
  const extras: LinhaFolha[] = [];
  for (const p of pessoas) {
    const daFolha = p.tecnicoId ? linhas.find((l) => l.tecnicoId === p.tecnicoId && !l.usuarioId) : undefined;
    if (daFolha) { daFolha.usuarioId = p.usuarioId; daFolha.comissao = centavos(p.valor); continue; }
    extras.push({ tecnicoId: p.tecnicoId, usuarioId: p.usuarioId, nome: p.nome, perfil: PERFIL_SO_COMISSAO, posicao: null, escore: null, faixa: null, valor: 0, comissao: centavos(p.valor) });
  }
  extras.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const todas = [...linhas, ...extras];
  return { linhas: todas, total: centavos(todas.reduce((s, l) => s + l.valor, 0)), totalComissao: centavos(todas.reduce((s, l) => s + (l.comissao ?? 0), 0)) };
}

/** O que cada pessoa recebe no mês: bônus + comissão */
export const totalDaLinha = (l: Pick<LinhaFolha, "valor" | "comissao">) => centavos(l.valor + (l.comissao ?? 0));

/* ───────── quem ganhou a premiação ───────── */

export const CRITERIOS = ["ESCORE", "AVALIACAO", "PENALIDADES", "PRAZO", "DIVIDIDO"] as const;
export type Criterio = (typeof CRITERIOS)[number];
/** Como o ganhador foi decidido, para a tela explicar */
export const TEXTO_CRITERIO: Record<Criterio, string> = {
  ESCORE: "Maior escore",
  AVALIACAO: "Empate no escore: desempatou a maior média de avaliação do cliente",
  PENALIDADES: "Empate no escore e na avaliação: desempatou quem teve menos penalidades",
  PRAZO: "Empate no escore, na avaliação e nas penalidades: desempatou quem teve mais atividades no prazo",
  DIVIDIDO: "Empate em todos os critérios: o prêmio é dividido",
};

export interface Ganhador { tecnicoId: string; nome: string; escore: number }
export interface PremioFechado {
  premiacaoId: string; titulo: string; descricao: string | null; perfil: string | null;
  /** Um ganhador; mais de um só quando o empate resiste a todos os critérios (prêmio dividido). Vazio = ninguém acima da meta */
  ganhadores: Ganhador[];
  /** null quando não há ganhador */
  criterio: Criterio | null;
}

type Disputante = GrupoRanking["linhas"][number] & { escore: number };

/** Fica só com quem tem o MAIOR valor do critério. */
function osMelhores(lista: Disputante[], valor: (l: Disputante) => number): Disputante[] {
  const maior = Math.max(...lista.map(valor));
  return lista.filter((l) => valor(l) === maior);
}

/**
 * Quem ganha o prêmio: o MAIOR escore do escopo (o perfil do prêmio, ou todos os perfis), só entre quem
 * atingiu a meta mínima. Empate se resolve, nesta ordem: maior média de avaliação do cliente → menos
 * penalidades que contaram → mais atividades no prazo. Se ainda empatar, dividem o prêmio.
 */
export function ganhadoresDoPremio(grupos: GrupoRanking[], perfil: string | null): { ganhadores: Ganhador[]; criterio: Criterio | null } {
  const noEscopo = grupos.filter((g) => !perfil || g.perfil.nome === perfil).flatMap((g) => g.linhas)
    .filter((l): l is Disputante => l.escore !== null && l.atingiuMeta);
  if (!noEscopo.length) return { ganhadores: [], criterio: null };
  const passos: [Criterio, (l: Disputante) => number][] = [
    ["ESCORE", (l) => l.escore],
    // Quem não foi avaliado no mês perde o desempate para quem foi
    ["AVALIACAO", (l) => l.desempate?.mediaAvaliacao ?? -1],
    ["PENALIDADES", (l) => -(l.desempate?.penalidades ?? 0)],
    ["PRAZO", (l) => l.desempate?.noPrazo ?? 0],
  ];
  let disputa = noEscopo;
  let criterio: Criterio = "ESCORE";
  for (const [nome, valor] of passos) {
    criterio = nome;
    disputa = osMelhores(disputa, valor);
    if (disputa.length === 1) break;
  }
  if (disputa.length > 1) criterio = "DIVIDIDO";
  const ganhadores = disputa.map((l) => ({ tecnicoId: l.tecnicoId, nome: l.nome, escore: l.escore })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { ganhadores, criterio };
}

/** Os prêmios do mês com quem ganha cada um (a prévia antes de fechar e o que fica gravado ao fechar). */
export function premiosDoMes(painel: Pick<PainelCongelado, "grupos" | "premiacoes">): PremioFechado[] {
  return painel.premiacoes.map((p) => ({ premiacaoId: p.id, titulo: p.titulo, descricao: p.descricao, perfil: p.perfil, ...ganhadoresDoPremio(painel.grupos, p.perfil) }));
}

/** Os prêmios guardados no fechamento (JSON): só o que tem a forma certa. */
export function lerPremios(json: unknown): PremioFechado[] {
  if (!Array.isArray(json)) return [];
  return json.filter((p): p is PremioFechado => !!p && typeof p === "object" && typeof (p as PremioFechado).titulo === "string" && Array.isArray((p as PremioFechado).ganhadores))
    .map((p) => ({ ...p, criterio: (CRITERIOS as readonly string[]).includes(p.criterio ?? "") ? p.criterio : null }));
}

/* ───────── valores em reais ───────── */

const semValorNasFaixas = (faixas: { nome: string; minimo: number; valor: number | null }[]) => faixas.map((f) => ({ nome: f.nome, minimo: f.minimo, valor: null }));

/** O painel congelado para quem NÃO pode ver valores: sem bônus e sem o valor das faixas. */
export function semValores<T extends Painel>(painel: T): T {
  return {
    ...painel,
    grupos: painel.grupos.map((g) => ({
      ...g, regra: g.regra ? { ...g.regra, faixas: semValorNasFaixas(g.regra.faixas) } : null, linhas: g.linhas.map((l) => ({ ...l, bonus: null })),
    })),
  };
}

/* ───────── exportação ───────── */

const br = (n: number, casas: number) => n.toFixed(casas).replace(".", ",");

/** A folha em linhas de planilha (CSV para o financeiro): uma por colaborador, com o total no fim. */
export function linhasDoCsv(competencia: string, folha: Folha, premios: PremioFechado[]): string[][] {
  const premiosDe = (tecnicoId: string | null) => premios.filter((p) => !!tecnicoId && p.ganhadores.some((g) => g.tecnicoId === tecnicoId)).map((p) => p.titulo).join(" / ");
  // COM-1: com comissão no mês, a planilha ganha "Comissão" e "Total" (sem comissão, fica como sempre foi)
  if ((folha.totalComissao ?? 0) !== 0 || folha.linhas.some((l) => (l.comissao ?? 0) !== 0)) {
    const totalComissao = folha.totalComissao ?? centavos(folha.linhas.reduce((s, l) => s + (l.comissao ?? 0), 0));
    return [
      ["Competência", "Colaborador", "Perfil", "Posição", "Escore (%)", "Faixa", "Bônus (R$)", "Comissão (R$)", "Total (R$)", "Premiação"],
      ...folha.linhas.map((l) => [
        competenciaCurta(competencia), l.nome, l.perfil, l.posicao === null ? "" : String(l.posicao), l.escore === null ? "" : br(l.escore, 1), l.faixa ?? "",
        br(l.valor, 2), br(l.comissao ?? 0, 2), br(totalDaLinha(l), 2), premiosDe(l.tecnicoId),
      ]),
      ["", "Total", "", "", "", "", br(folha.total, 2), br(totalComissao, 2), br(centavos(folha.total + totalComissao), 2), ""],
    ];
  }
  return [
    ["Competência", "Colaborador", "Perfil", "Posição", "Escore (%)", "Faixa", "Bônus (R$)", "Premiação"],
    ...folha.linhas.map((l) => [
      competenciaCurta(competencia), l.nome, l.perfil, l.posicao === null ? "" : String(l.posicao), l.escore === null ? "" : br(l.escore, 1), l.faixa ?? "", br(l.valor, 2), premiosDe(l.tecnicoId),
    ]),
    ["", "Total", "", "", "", "", br(folha.total, 2), ""],
  ];
}

export const nomeDoArquivo = (competencia: string, versao: number) => `bonus-desempenho-${competencia}${versao > 1 ? `-v${versao}` : ""}.csv`;

/* ───────── o que a tela manda ───────── */

export const fecharSchema = z.object({
  competencia: z.string().regex(COMPETENCIA_RE, "Informe o mês a fechar."),
  /** Confirmação dos avisos (itens a revisar que ficam de fora; mês que ainda não terminou) */
  ciente: z.boolean().optional(),
}).strict();

export const MOTIVO_REABERTURA_MIN = 10;
export const MSG_MOTIVO_REABERTURA = `Explique por que o mês está sendo reaberto (mínimo ${MOTIVO_REABERTURA_MIN} caracteres).`;
export const reabrirSchema = z.object({
  motivo: z.string({ required_error: MSG_MOTIVO_REABERTURA }).trim().min(MOTIVO_REABERTURA_MIN, MSG_MOTIVO_REABERTURA).max(500, "Motivo com no máximo 500 caracteres."),
}).strict();
