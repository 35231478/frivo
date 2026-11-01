/**
 * PR3-A: ligar/desligar o faturamento automático (ou a aprovação automática) do contrato fatura sem
 * ninguém olhar — por isso pede, além de editar o contrato, a permissão "Financeiro › Medições".
 */
import { pode, type Permissoes } from "@/lib/permissoes";

type Chaves = { faturamentoAutomatico?: boolean | null; aprovacaoAutomatica?: boolean | null };

/** Mudou alguma chave de automação em relação ao que está gravado? (ausente no corpo = não mudou) */
export function mudaAutomacao(novo: Chaves, atual: Chaves = {}) {
  return (["faturamentoAutomatico", "aprovacaoAutomatica"] as const)
    .some((k) => novo[k] !== undefined && novo[k] !== null && !!novo[k] !== !!atual[k]);
}

export const podeAutomatizarFaturamento = (u: { permissoes?: unknown; role?: string | null }) =>
  pode(u.permissoes as Permissoes, "financeiro", "medicoes", (u.role ?? undefined) as never);

export const ERRO_SEM_PERMISSAO_AUTOMACAO = "Ligar ou desligar o faturamento automático pede a permissão Financeiro › Medições.";
