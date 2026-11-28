/**
 * COM-2B — a comissão do técnico NO APP, ao vivo e sem sinal (regra pura, roda no aparelho).
 *
 * O servidor manda no retrato da atividade, para o técnico logado, quanto ELE ganha por equipamento quando o
 * equipamento estiver feito e completo (a conta é do servidor: nenhuma regra, base, custo ou valor de colega vem
 * para o aparelho) e o que já nasceu lá. O app junta isso com o estado local (a fila):
 *  - equipamento feito e completo, já confirmado pelo servidor → "Prevista";
 *  - feito e completo só no aparelho (o servidor ainda não confirmou) → "Prevista (aguardando envio)";
 *  - incompleto → nada (a trava de qualidade é a mesma do servidor: lib/execucao/pendencias).
 * O servidor confirma no sync (a comissão nasce lá, pela mesma conta).
 */

/** O que vem no retrato da atividade (ausente/null = a empresa não paga técnico, ou não se aplica a quem está logado) */
export interface ComissaoRetrato {
  /** equipamentoId → quanto este técnico ganha com o equipamento feito e completo */
  porEquipamento: Record<string, number>;
  /** equipamentoId → o que o servidor já confirmou (a comissão nasceu) */
  confirmadas: Record<string, number>;
}

export type SituacaoNoApp = "PREVISTA" | "AGUARDANDO_ENVIO";
export interface ComissaoNoApp { valor: number; situacao: SituacaoNoApp }

export const ROTULO_SITUACAO_APP: Record<SituacaoNoApp, string> = { PREVISTA: "Prevista", AGUARDANDO_ENVIO: "Prevista (aguardando envio)" };

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** O equipamento como o app o vê agora (estado local: retrato + fila) */
export interface EquipamentoNoApp { equipamento: { id: string }; feito: boolean; completo: boolean }

/** A comissão de cada equipamento na tela: só o feito E completo; confirmada pelo servidor = Prevista, senão aguardando envio */
export function comissoesDaTela(equipamentos: readonly EquipamentoNoApp[], c: ComissaoRetrato | null | undefined): Map<string, ComissaoNoApp> {
  const r = new Map<string, ComissaoNoApp>();
  if (!c) return r;
  for (const e of equipamentos) {
    if (!e.feito || !e.completo) continue;
    const id = e.equipamento.id;
    const confirmada = c.confirmadas[id];
    if (confirmada && confirmada > 0) { r.set(id, { valor: r2(confirmada), situacao: "PREVISTA" }); continue; }
    const valor = c.porEquipamento[id];
    if (valor && valor > 0) r.set(id, { valor: r2(valor), situacao: "AGUARDANDO_ENVIO" });
  }
  return r;
}

/** O total "aguardando envio" de várias atividades (o card do Meu dia, também sem sinal) */
export function totalAguardandoEnvio(atividades: readonly { equipamentos: readonly EquipamentoNoApp[]; comissao?: ComissaoRetrato | null }[]): number {
  let t = 0;
  for (const a of atividades) for (const v of comissoesDaTela(a.equipamentos, a.comissao).values()) if (v.situacao === "AGUARDANDO_ENVIO") t += v.valor;
  return r2(t);
}

/** O extrato guardado no aparelho (para o card abrir sem sinal com o último valor conhecido) */
export interface TotaisGuardados { prevista: number; liberada: number; paga: number; em: string }
export const CHAVE_TOTAIS = "frivo:comissoes-totais";
