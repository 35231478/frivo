/**
 * COM-1.2 — COMISSÃO SOBRE CONTRATO, as regras (sem banco e sem tela).
 *
 *  - Quem ganha é o VENDEDOR DO CONTRATO (o da proposta que o originou, ou quem o criou): travado, trocável só com
 *    "Trocar vendedor" + motivo. Contrato de antes desta leva não tem vendedor: não gera nada (sem retroativo).
 *  - A comissão nasce PREVISTA quando o contrato é FECHADO — vira ATIVO (criado ativo, proposta convertida, ou saiu
 *    de "Aguardando assinatura"). Proposta aceita não basta: precisa ser contrato ativo.
 *  - Duas bases (cada uma com a sua precedência — pessoa > cargo > todos; contrato de um TIPO vence "todos os contratos"):
 *      · "% das mensalidades recebidas" durante os primeiros N meses (padrão 3; 0 = enquanto o contrato estiver ativo):
 *        uma comissão por mensalidade da janela, LIBERADA proporcionalmente ao que entrou daquela mensalidade;
 *      · "Valor fixo no fechamento": uma comissão, liberada com a 1ª mensalidade do ciclo, proporcional ao que entrou dela.
 *    O gatilho do contrato é sempre o RECEBIMENTO (o dinheiro manda), qualquer que seja o "quando" da empresa.
 *  - Contrato cancelado/suspenso/encerrado: as mensalidades dali em diante não geram (o que já foi liberado fica);
 *    mensalidade estornada/cancelada estorna a comissão dela; reajuste vale para as próximas (a base é a mensalidade).
 *  - Renovação (voltar a ATIVO de "Em renovação" ou "Vencido") abre um ciclo novo só com "Renovação também gera".
 */
import { round2, type Beneficiario, type RegraComissao, type TipoContrato, pesoDaRegraDeContrato, MESES_PADRAO } from "./regras";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ───────── competências ("AAAA-MM") ───────── */

export const competencia = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;
export const competenciaDe = (d: Date) => competencia(d.getUTCFullYear(), d.getUTCMonth() + 1);
export function lerCompetencia(c: string): { ano: number; mes: number } {
  const [a, m] = c.split("-").map(Number);
  return { ano: a, mes: m };
}
export function somarCompetencia(c: string, n: number): string {
  const { ano, mes } = lerCompetencia(c);
  const t = ano * 12 + (mes - 1) + n;
  return competencia(Math.floor(t / 12), (t % 12) + 1);
}
/** "03/2027" */
export const rotuloCompetencia = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

/**
 * As mensalidades (competências) do ciclo que entram na janela: a partir do 1º mês do ciclo, de `passo` em `passo`
 * meses (a periodicidade da cobrança), enquanto o mês for anterior a início + N meses e não passar do fim da vigência.
 * N = 0 (enquanto ativo) devolve null: a janela é aberta (as mensalidades entram conforme o contrato cobra).
 */
export function competenciasDaJanela(o: { cicloInicio: string; meses: number; passo?: number; ultimaVigente?: string | null }): string[] | null {
  if (o.meses <= 0) return null;
  const passo = Math.max(1, Math.trunc(num(o.passo) || 1));
  const limite = somarCompetencia(o.cicloInicio, o.meses);
  const r: string[] = [];
  for (let c = o.cicloInicio; c < limite; c = somarCompetencia(c, passo)) {
    if (o.ultimaVigente && c > o.ultimaVigente) break;
    r.push(c);
  }
  return r;
}

/** A mensalidade entra na janela do ciclo? (N = 0: qualquer uma a partir do início) */
export function naJanela(c: string, cicloInicio: string, meses: number): boolean {
  if (c < cicloInicio) return false;
  return meses <= 0 || c < somarCompetencia(cicloInicio, meses);
}

/* ───────── a regra que vale ───────── */

export type BaseContrato = "PERC_MENSALIDADE" | "FIXO_CONTRATO";

/** A regra se aplica ao contrato deste tipo, para esta pessoa, nesta base? */
export function regraDeContratoSeAplica(r: RegraComissao, pessoa: Beneficiario, tipo: string | null | undefined, base: BaseContrato): boolean {
  if (r.ativo === false || r.papel !== "VENDEDOR" || r.sobreTipo !== "CONTRATOS" || r.base !== base) return false;
  if (r.tipoContrato && r.tipoContrato !== tipo) return false;
  if (r.quemTipo === "PESSOA") return r.usuarioId === pessoa.usuarioId;
  if (r.quemTipo === "CARGO") return !!pessoa.cargoId && r.cargoId === pessoa.cargoId;
  return true;
}

/** A regra que vale para o contrato nesta base: a mais específica (tipo > todos; pessoa > cargo > todos). Null = nada nesta base. */
export function regraDoContrato(regras: readonly RegraComissao[], pessoa: Beneficiario, tipo: string | null | undefined, base: BaseContrato): RegraComissao | null {
  let melhor: RegraComissao | null = null;
  for (const r of regras) {
    if (!regraDeContratoSeAplica(r, pessoa, tipo, base)) continue;
    const p = pesoDaRegraDeContrato(r), pm = melhor ? pesoDaRegraDeContrato(melhor) : -1;
    if (!melhor || p > pm || (p === pm && r.id < melhor.id)) melhor = r;
  }
  return melhor;
}

/** A janela da regra "% das mensalidades" (sem valor gravado = o padrão) */
export const mesesDaRegra = (r: Pick<RegraComissao, "meses">) => (Number.isInteger(r.meses) && Number(r.meses) >= 0 ? Number(r.meses) : MESES_PADRAO);

/* ───────── o ciclo: fechamento e renovação ───────── */

/** O contrato acabou de ser FECHADO? (virou ATIVO saindo de "Aguardando assinatura") */
export const ehFechamento = (anterior: string | null | undefined, novo: string) => novo === "ATIVO" && anterior === "AGUARDANDO_ASSINATURA";
/** O contrato foi RENOVADO? (voltou a ATIVO de "Em renovação" ou "Vencido") */
export const ehRenovacao = (anterior: string | null | undefined, novo: string) => novo === "ATIVO" && (anterior === "EM_RENOVACAO" || anterior === "VENCIDO");

/**
 * O 1º mês do ciclo: o mais tarde entre o mês do início do contrato e o mês do fechamento (um contrato cadastrado
 * hoje com início no passado não paga comissão de mensalidade antiga: sem retroativo); na renovação, o mês dela.
 */
export function inicioDoCiclo(o: { renovacao: boolean; dataInicio: Date; agora: Date }): string {
  const agora = competenciaDe(o.agora);
  if (o.renovacao) return agora;
  const ini = competenciaDe(o.dataInicio);
  return ini > agora ? ini : agora;
}

/* ───────── as linhas (uma por mensalidade + o fixo) ───────── */

export const ITEM_FIXO = "FIXO";
/** A chave única da comissão de contrato: contrato × ciclo × parte (mensalidade ou fixo) × pessoa */
export const chaveDoContrato = (contratoId: string, cicloInicio: string, parte: string, usuarioId: string) => `ct:${contratoId}:${cicloInicio}:${parte}:${usuarioId}`;

/** "Mensalidade 03/2027" · "Fechamento do contrato" · "Renovação do contrato" */
export function descricaoDaParte(parte: string, renovacao = false): string {
  if (parte === ITEM_FIXO) return renovacao ? "Renovação do contrato" : "Fechamento do contrato";
  return `Mensalidade ${rotuloCompetencia(parte)}`;
}

/** O valor previsto da comissão da mensalidade: a taxa sobre o valor da mensalidade */
export const valorDaMensalidade = (taxa: number, mensalidade: number) => round2(Math.max(0, num(mensalidade)) * num(taxa) / 100);

/* ───────── o que já é devido ───────── */

/**
 * A mensalidade ainda conta para a comissão? Contrato ATIVO: sim. Fora de ATIVO (cancelado, suspenso, encerrado…),
 * só as mensalidades ANTERIORES ao mês em que ele parou ("para de gerar a partir dali").
 */
export function mensalidadeCoberta(c: string, contrato: { ativo: boolean; paradoDesde: string | null }): boolean {
  if (contrato.ativo) return true;
  return !!contrato.paradoDesde && c < contrato.paradoDesde;
}

/**
 * O ALVO liberado de uma parte do contrato: a taxa sobre o que entrou da mensalidade (ou o fixo × a fração recebida
 * da 1ª mensalidade). Mensalidade que não conta mais (contrato parado) não libera nada novo — mas estorna se o
 * dinheiro voltar (o alvo nunca passa do que já foi liberado).
 */
export function alvoDaParte(o: { base: BaseContrato; taxa: number; valor: number; recebido: number; mensalidade: number; coberta: boolean; jaLiberado: number }): number {
  const fracao = num(o.mensalidade) > 0 ? Math.min(1, Math.max(0, num(o.recebido) / num(o.mensalidade))) : 0;
  const devido = o.base === "FIXO_CONTRATO" ? round2(num(o.valor) * fracao) : round2(Math.min(num(o.recebido), Math.max(0, num(o.mensalidade))) * num(o.taxa) / 100);
  return o.coberta ? devido : Math.min(round2(num(o.jaLiberado)), devido);
}

export const MOTIVO_MENSALIDADE = "Mensalidade do contrato recebida";
export const MOTIVO_ESTORNO_MENSALIDADE = "Mensalidade estornada ou cancelada";
export const MOTIVO_TROCA_CONTRATO = "Troca de vendedor do contrato";

/** A comissão do contrato nasce para este tipo? (contrato que não tem tipo cadastrado conta como "todos os contratos") */
export type { TipoContrato };
