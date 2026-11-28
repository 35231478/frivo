/**
 * COM-2 — a comissão do EXECUTOR (o técnico), regra pura (sem banco e sem tela).
 *
 *  - A UNIDADE é o equipamento atendido × a linha de serviço da OS. Na base "% da venda" (e "% do lucro") cada
 *    equipamento ATENDIDO ganha a sua parte da linha: o valor da linha ÷ os equipamentos vinculados à OS (o vinculado
 *    que ninguém atendeu não gera nada). No "valor fixo por item", é R$ por equipamento atendido.
 *    OS sem equipamento (módulo desligado ou tipo que não pede): a unidade é a própria linha, inteira.
 *  - DOIS OU MAIS técnicos: cada um recebe pela regra que vence para ELE (pessoa > cargo > todos, como no vendedor),
 *    vezes a parte dele pela DIVISÃO da regra — Igual; Para quem executou (quem marcou o equipamento como feito);
 *    ou % por cargo (normalizado sobre os cargos de quem está lá). A parte e a divisão ficam congeladas.
 *  - TRAVA DE QUALIDADE: só existe comissão (Prevista) para o equipamento feito E com o relatório completo (a mesma
 *    regra que libera a conclusão no app). Ela é LIBERADA no gatilho do técnico (conclusão da OS, aceite do cliente
 *    ou recebimento). Relatório reaberto, OS cancelada ou retorno confirmado pelo encarregado = estorno.
 *  - RETORNO no mesmo equipamento dentro dos dias da configuração: a comissão fica EM REVISÃO (não libera mais
 *    nada); o encarregado decide estornar ou manter, com motivo — e ninguém decide a própria.
 *  - TETO mensal por pessoa ou cargo: o que passa do teto no fechamento vai para o mês seguinte (não se perde).
 */
import { z } from "zod";
import { round2, regraVencedora, valorDaComissao, type Divisao, type ItemVenda, type QuandoExecutor, type RegraComissao } from "./regras";
import { origemDoRetorno, type ServicoNoEquipamento } from "@/lib/desempenho/regras";
import { repartir } from "@/lib/orcamentos/calculo";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ───────── a unidade ───────── */

/** Uma linha da OS (o que o cliente paga). `custo` null = desconhecido (o "% do lucro" não calcula). */
export interface LinhaOs {
  id: string;
  tipo: "SERVICO" | "PRODUTO";
  servicoId?: string | null;
  categoria?: string | null;
  descricao: string;
  quantidade: unknown;
  valorTotal: unknown;
  custo: number | null;
}

/** Um equipamento atendido: a atividade onde foi feito e quem o marcou como feito */
export interface Atendido { atividadeId: string; equipamentoId: string; feitoPorTecnicoId?: string | null }

export interface Unidade {
  /** "EQ" = equipamento × linha; "LINHA" = OS sem equipamento */
  tipo: "EQ" | "LINHA";
  atividadeId: string | null;
  equipamentoId: string | null;
  feitoPorTecnicoId: string | null;
  linhaId: string;
  /** O item como a regra o vê (a parte da linha, já dividida pelos equipamentos vinculados) */
  item: ItemVenda;
}

/**
 * As unidades da OS. `vinculados` = quantos equipamentos distintos a OS tem (atendidos ou não). Sem equipamento
 * vinculado, uma unidade por linha. Com equipamento, uma por (equipamento atendido × linha) — a venda e o custo da
 * linha divididos pelos vinculados; o "por item" conta 1 por equipamento.
 */
export function unidadesDaOs(linhas: readonly LinhaOs[], vinculados: number, atendidos: readonly Atendido[]): Unidade[] {
  const base = (l: LinhaOs, fator: number, quantidade: number): ItemVenda => {
    const venda = round2(num(l.valorTotal) * fator);
    return {
      tipo: l.tipo, id: l.id, servicoId: l.servicoId ?? null, categoria: l.categoria ?? null, descricao: l.descricao,
      quantidade, venda, vendaLiquida: venda, custo: l.custo == null ? null : round2(l.custo * fator),
    };
  };
  if (vinculados <= 0) {
    return linhas.map((l) => ({ tipo: "LINHA", atividadeId: null, equipamentoId: null, feitoPorTecnicoId: null, linhaId: l.id, item: base(l, 1, num(l.quantidade)) }));
  }
  const r: Unidade[] = [];
  for (const a of atendidos) {
    for (const l of linhas) {
      r.push({ tipo: "EQ", atividadeId: a.atividadeId, equipamentoId: a.equipamentoId, feitoPorTecnicoId: a.feitoPorTecnicoId ?? null, linhaId: l.id, item: base(l, 1 / vinculados, 1) });
    }
  }
  return r;
}

/** A chave única da comissão do técnico (gerar de novo nunca duplica) */
export const chaveDoExecutor = (osId: string, u: Pick<Unidade, "atividadeId" | "equipamentoId" | "linhaId">, usuarioId: string) =>
  `EXEC:${osId}:${u.atividadeId ?? "-"}:${u.equipamentoId ?? "-"}:${u.linhaId}:${usuarioId}`;

/* ───────── a divisão ───────── */

/** Quem estava na atividade: o usuário (o login, ligado pelo e-mail), o colaborador e o cargo dele */
export interface Participante { usuarioId: string; tecnicoId: string; cargoId: string | null; nome: string }

const r4Fixo = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * A parte (0 a 1) de cada pessoa pela divisão. "Para quem executou" sem saber quem marcou (ou quem marcou não está
 * entre os técnicos) e "% por cargo" sem nenhum cargo com % viram Igual — o dinheiro nunca some.
 */
export function partesDaDivisao(divisao: Divisao | null | undefined, participantes: readonly Participante[], o: { feitoPorTecnicoId?: string | null; divisaoCargos?: Record<string, number> | null; exata?: boolean } = {}): Map<string, number> {
  const partes = new Map<string, number>();
  const n = participantes.length;
  if (!n) return partes;
  // `exata`: sem arredondar a parte (para repartir o dinheiro sem perder centavo); a parte gravada/mostrada é a de 4 casas
  const r4 = (v: number) => (o.exata ? v : r4Fixo(v));
  const igual = () => { participantes.forEach((p) => partes.set(p.usuarioId, r4(1 / n))); return partes; };
  if (divisao === "POR_EXECUTOR") {
    const quem = participantes.find((p) => !!o.feitoPorTecnicoId && p.tecnicoId === o.feitoPorTecnicoId);
    if (!quem) return igual();
    participantes.forEach((p) => partes.set(p.usuarioId, p === quem ? 1 : 0));
    return partes;
  }
  if (divisao === "POR_CARGO") {
    const peso = (p: Participante) => Math.max(0, num(p.cargoId ? o.divisaoCargos?.[p.cargoId] : 0));
    const total = participantes.reduce((s, p) => s + peso(p), 0);
    if (total <= 0) return igual();
    participantes.forEach((p) => partes.set(p.usuarioId, r4(peso(p) / total)));
    return partes;
  }
  return igual();
}

/* ───────── o valor ───────── */

export interface ComissaoDoExecutor {
  participante: Participante;
  regra: RegraComissao;
  parte: number;
  divisao: Divisao;
  baseValor: number;
  taxa: number;
  valor: number;
}

/**
 * As comissões de uma unidade: para cada técnico, a regra de Executor que vence para ELE, o valor da unidade por
 * essa regra e a parte dele pela divisão dessa regra. Quem não tem regra, ou fica com parte zero, não entra.
 */
export function comissoesDaUnidade(u: Unidade, participantes: readonly Participante[], regras: readonly RegraComissao[], liquidaImpostos: boolean): ComissaoDoExecutor[] {
  const cand: (Omit<ComissaoDoExecutor, "valor"> & { exata: number; cheio: number })[] = [];
  for (const p of participantes) {
    const regra = regraVencedora(regras, { usuarioId: p.usuarioId, cargoId: p.cargoId }, u.item, "EXECUTOR");
    if (!regra) continue;
    const divisao: Divisao = regra.divisao ?? "IGUAL";
    const o = { feitoPorTecnicoId: u.feitoPorTecnicoId, divisaoCargos: regra.divisaoCargos };
    const exata = partesDaDivisao(divisao, participantes, { ...o, exata: true }).get(p.usuarioId) ?? 0;
    if (exata <= 0) continue;
    const parte = partesDaDivisao(divisao, participantes, o).get(p.usuarioId) ?? 0;
    const v = valorDaComissao(regra, u.item, liquidaImpostos);
    cand.push({ participante: p, regra, parte, divisao, baseValor: v.baseValor, taxa: v.taxa, exata, cheio: v.valor });
  }
  // PJ4: quem divide a MESMA regra reparte o valor dela pelo maior resto — 3 técnicos em R$ 3.000 somam R$ 3.000,00
  // (antes, a parte arredondada a 4 casas dava 999,90 × 3 = 2.999,70; com 6, pagava 3.000,60)
  const valores = new Map<ComissaoDoExecutor["participante"], number>();
  for (const regraId of new Set(cand.map((c) => c.regra.id))) {
    const grupo = cand.filter((c) => c.regra.id === regraId);
    const total = round2(grupo[0].cheio * grupo.reduce((s, c) => s + c.exata, 0));
    repartir(total, grupo.map((c) => c.exata)).forEach((v, i) => valores.set(grupo[i].participante, v));
  }
  return cand
    .map(({ exata: _e, cheio: _c, ...c }) => ({ ...c, valor: valores.get(c.participante) ?? 0 }))
    .filter((c) => c.valor > 0);
}

/* ───────── quando fica devida ───────── */

export type SituacaoRevisao = "A_REVISAR" | "ESTORNAR" | "MANTER";

export interface EstadoDoExecutor {
  /** A OS não foi cancelada */
  osViva: boolean;
  /** A unidade continua valendo: equipamento feito, relatório completo (e a linha ainda existe) */
  qualidade: boolean;
  osConcluida: boolean;
  /** O cliente confirmou o aceite */
  aceite: boolean;
  /** 0 a 1: quanto da OS já entrou (RECEBIMENTO) */
  fracao: number;
  /** A pior revisão de retorno desta comissão (ESTORNAR > A_REVISAR > MANTER), ou null */
  revisao: SituacaoRevisao | null;
}

/**
 * O ALVO liberado da comissão do técnico agora. Sem qualidade, OS cancelada ou retorno confirmado: zero (estorno do
 * que tiver sido liberado). Em revisão: não libera nada a mais (fica no que já estava). Fora isso, o gatilho manda.
 */
export function alvoDoExecutor(c: { valor: number; quando: QuandoExecutor }, e: EstadoDoExecutor, jaLiberado: number): number {
  if (!e.osViva || !e.qualidade || e.revisao === "ESTORNAR") return 0;
  const valor = round2(num(c.valor));
  const alvo = c.quando === "CONCLUSAO_OS" ? (e.osConcluida ? valor : 0)
    : c.quando === "ACEITE" ? (e.aceite ? valor : 0)
    : round2(valor * Math.min(1, Math.max(0, num(e.fracao))));
  if (e.revisao === "A_REVISAR") return round2(Math.min(alvo, Math.max(0, num(jaLiberado))));
  return alvo;
}

/** A revisão que manda: ESTORNAR > A_REVISAR > MANTER */
export function piorRevisao(situacoes: readonly string[]): SituacaoRevisao | null {
  if (situacoes.includes("ESTORNAR")) return "ESTORNAR";
  if (situacoes.includes("A_REVISAR")) return "A_REVISAR";
  return situacoes.includes("MANTER") ? "MANTER" : null;
}

export const MOTIVO_EXECUTOR: Record<QuandoExecutor, string> = {
  CONCLUSAO_OS: "OS concluída", ACEITE: "Aceite do cliente", RECEBIMENTO: "Recebimento da OS",
};

/** Por que o alvo desceu (o motivo do estorno) */
export function motivoDoEstornoExecutor(e: EstadoDoExecutor): string {
  if (!e.osViva) return "OS cancelada";
  if (e.revisao === "ESTORNAR") return "Retorno no mesmo equipamento (confirmado na revisão)";
  if (!e.qualidade) return "O relatório do equipamento ficou incompleto (ou o serviço saiu da OS)";
  return "O gatilho deixou de valer (OS reaberta, aceite desfeito ou recebimento estornado)";
}

/* ───────── o retorno ───────── */

/**
 * Este serviço (a atividade no equipamento) é a ORIGEM do retorno? Usa a mesma regra do Desempenho: o retorno
 * "volta" do ÚLTIMO serviço no equipamento antes de a OS do retorno ser aberta, em outra OS, dentro dos dias.
 * `dias` 0 = revisão de retorno desligada (a janela fecha sozinha: nenhum serviço é posterior à abertura).
 */
export function ehOrigemDoRetorno(servicos: readonly ServicoNoEquipamento[], retorno: { ordemServicoId: string; abertaEm: Date }, dias: number, servico: Pick<ServicoNoEquipamento, "atividadeId">): boolean {
  return origemDoRetorno([...servicos], retorno, dias)?.atividadeId === servico.atividadeId;
}

/* ───────── o teto do mês ───────── */

export interface TetoComissao { quemTipo: "PESSOA" | "CARGO"; usuarioId?: string | null; cargoId?: string | null; valor: number; ativo?: boolean }

/** O teto da pessoa: o dela vence o do cargo; dois do mesmo nível = o menor. null = sem teto. */
export function tetoDaPessoa(tetos: readonly TetoComissao[], p: { usuarioId: string; cargoId: string | null }): number | null {
  const ativos = tetos.filter((t) => t.ativo !== false && num(t.valor) > 0);
  const daPessoa = ativos.filter((t) => t.quemTipo === "PESSOA" && t.usuarioId === p.usuarioId).map((t) => num(t.valor));
  if (daPessoa.length) return Math.min(...daPessoa);
  const doCargo = ativos.filter((t) => t.quemTipo === "CARGO" && !!p.cargoId && t.cargoId === p.cargoId).map((t) => num(t.valor));
  return doCargo.length ? Math.min(...doCargo) : null;
}

export interface PessoaNoMes { usuarioId: string; nome: string; tecnicoId: string | null; valor: number }
export interface Excedente { usuarioId: string; nome: string; excedente: number; teto: number }

/**
 * Aplica o teto: quem passou recebe o teto neste mês e o EXCEDENTE vai para o mês seguinte (o servidor grava o par
 * −/+ no fechamento). Quem ficou abaixo, nada muda.
 */
export function aplicarTetos(pessoas: readonly PessoaNoMes[], tetos: readonly TetoComissao[], cargoDe: ReadonlyMap<string, string | null>): { pessoas: PessoaNoMes[]; excedentes: Excedente[] } {
  const excedentes: Excedente[] = [];
  const saida = pessoas.map((p) => {
    const teto = tetoDaPessoa(tetos, { usuarioId: p.usuarioId, cargoId: cargoDe.get(p.usuarioId) ?? null });
    if (teto === null || p.valor <= teto) return p;
    excedentes.push({ usuarioId: p.usuarioId, nome: p.nome, excedente: round2(p.valor - teto), teto });
    return { ...p, valor: round2(teto) };
  });
  return { pessoas: saida, excedentes };
}

/** O primeiro instante do mês seguinte à competência ("2027-01" → 2027-02-01T00:00Z; o mês 12 vira janeiro sozinho) */
export function inicioDoMesSeguinte(competencia: string): Date {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(a, m, 1));
}

/* ───────── o que a tela manda ───────── */

export const tetoSchema = z.object({
  quemTipo: z.enum(["PESSOA", "CARGO"]),
  usuarioId: z.string().trim().min(1).nullish(),
  cargoId: z.string().trim().min(1).nullish(),
  valor: z.coerce.number({ invalid_type_error: "Informe o teto." }).positive("Informe um teto maior que zero.").max(10_000_000),
  ativo: z.boolean().optional(),
}).strict().superRefine((t, ctx) => {
  if (t.quemTipo === "PESSOA" && !t.usuarioId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["usuarioId"], message: "Escolha a pessoa." });
  if (t.quemTipo === "CARGO" && !t.cargoId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cargoId"], message: "Escolha o cargo." });
});

export const MOTIVO_REVISAO_MIN = 5;
export const decisaoRevisaoSchema = z.object({
  decisao: z.enum(["ESTORNAR", "MANTER"]),
  motivo: z.string({ required_error: "Explique a decisão." }).trim().min(MOTIVO_REVISAO_MIN, `Explique a decisão (mínimo ${MOTIVO_REVISAO_MIN} caracteres).`).max(500),
}).strict();
export const MSG_REVISAR_PROPRIA = "Você não pode decidir a revisão da sua própria comissão. Peça a outra pessoa.";
export const MSG_REVISAO_DECIDIDA = "Esta revisão já foi decidida.";
