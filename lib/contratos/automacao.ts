/**
 * PR3-A/B: ligar/desligar o faturamento automático do contrato (aprovação, NFS-e, boleto) fatura sem
 * ninguém olhar — por isso pede, além de editar o contrato, a permissão "Financeiro › Medições". A
 * NFS-e automática pede também "Financeiro › Fiscal" e o boleto automático "Financeiro › Contas a receber"
 * (as mesmas de emitir à mão).
 */
import { pode, type Permissoes } from "@/lib/permissoes";

type Chaves = {
  faturamentoAutomatico?: boolean | null; aprovacaoAutomatica?: boolean | null;
  emitirNfseAuto?: boolean | null; emitirBoletoAuto?: boolean | null;
};
const CHAVES = ["faturamentoAutomatico", "aprovacaoAutomatica", "emitirNfseAuto", "emitirBoletoAuto"] as const;
const muda = (novo: Chaves, atual: Chaves, k: (typeof CHAVES)[number]) => novo[k] !== undefined && novo[k] !== null && !!novo[k] !== !!atual[k];

/** Mudou alguma chave de automação em relação ao que está gravado? (ausente no corpo = não mudou) */
export function mudaAutomacao(novo: Chaves, atual: Chaves = {}) {
  return CHAVES.some((k) => muda(novo, atual, k));
}

export const podeAutomatizarFaturamento = (u: { permissoes?: unknown; role?: string | null }) =>
  pode(u.permissoes as Permissoes, "financeiro", "medicoes", (u.role ?? undefined) as never);

export const ERRO_SEM_PERMISSAO_AUTOMACAO = "Ligar ou desligar o faturamento automático pede a permissão Financeiro › Medições.";
export const ERRO_SEM_PERMISSAO_NFSE_AUTO = "Ligar ou desligar a emissão automática da NFS-e pede a permissão Financeiro › Fiscal.";
export const ERRO_SEM_PERMISSAO_BOLETO_AUTO = "Ligar ou desligar o boleto automático pede a permissão Financeiro › Contas a receber.";

type Usuario = { permissoes?: unknown; role?: string | null };
const tem = (u: Usuario, acao: string) => pode(u.permissoes as Permissoes, "financeiro", acao as never, (u.role ?? undefined) as never);

/** O que falta para mudar as chaves que vieram no corpo (null = pode). Mesma regra na tela e no servidor. */
export function faltaPermissaoAutomacao(novo: Chaves, atual: Chaves, u: Usuario): string | null {
  if (!mudaAutomacao(novo, atual)) return null;
  if (!podeAutomatizarFaturamento(u)) return ERRO_SEM_PERMISSAO_AUTOMACAO;
  if (muda(novo, atual, "emitirNfseAuto") && !tem(u, "fiscal")) return ERRO_SEM_PERMISSAO_NFSE_AUTO;
  if (muda(novo, atual, "emitirBoletoAuto") && !tem(u, "contasReceber")) return ERRO_SEM_PERMISSAO_BOLETO_AUTO;
  return null;
}
