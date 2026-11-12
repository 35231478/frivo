/**
 * Contas a Receber — marcar como perda e estorno de recebimento (regras puras, sem Prisma). A tela usa
 * estas regras para habilitar o menu ⋮ e o servidor usa as MESMAS para recusar.
 *
 * Perda (inadimplência): a cobrança em aberto tem o SALDO dado como perdido. O que já entrou continua
 * recebido; a nota fiscal não é cancelada; a receita original não é estornada (na DRE futura a perda é
 * despesa "Perdas com clientes" na data da marcação). Reverter: volta a receber, ou o cliente pagou
 * (recuperação, um recebimento normal).
 * Estorno: desfaz um recebimento informado errado (total ou parcial, inclusive a baixa antiga, de antes
 * do histórico de recebimentos): o saldo volta a ficar em aberto e o estorno fica na linha do tempo.
 */
import { saldoDaConta } from "@/lib/financeiro/parcelas";

/** Motivo mínimo (perda, estorno): uma palavra de verdade, não "." */
export const MOTIVO_MINIMO = 3;

export interface ContaPerda {
  status: string;
  valor: unknown;
  valorRecebido?: unknown;
  boletoStatus?: string | null;
  excluidaEm?: Date | string | null;
}

/** Marcar como perda: só a cobrança em aberto (liberada), com saldo e sem boleto que o cliente ainda paga */
export function motivoNaoMarcarPerda(c: ContaPerda): string | null {
  if (c.excluidaEm) return "Esta conta foi excluída.";
  if (c.status === "PERDA") return "Esta conta já está marcada como perda.";
  if (c.status === "PARCELADO") return "Conta parcelada: marque a perda em cada parcela.";
  if (c.status === "RENEGOCIADO") return "Conta renegociada: marque a perda nas parcelas da renegociação.";
  if (c.status === "RECEBIDO") return "Conta recebida não vira perda.";
  if (c.status === "CANCELADO") return "Conta cancelada não vira perda.";
  if (c.status === "PREVISTO") return "Ainda é previsão: não é cobrança.";
  if (c.boletoStatus === "EMITIDO") return "Cancele o boleto antes: o cliente ainda consegue pagá-lo.";
  if (!(saldoDaConta(c) > 0)) return "Não há nada em aberto nesta conta.";
  return null;
}

export const motivoNaoReverterPerda = (c: { status: string }): string | null =>
  c.status === "PERDA" ? null : "Esta conta não está marcada como perda.";

export interface RecebimentoEstorno { origem: string; estornadoEm?: Date | string | null }

/** Baixa total antiga: RECEBIDA antes do histórico de recebimentos (nenhuma linha gravada) */
export const temBaixaAntiga = (c: { status: string; valorRecebido?: unknown }) =>
  c.status === "RECEBIDO" && !(Number(c.valorRecebido ?? 0) > 0);

/**
 * Estornar um recebimento (ou a baixa antiga, quando `r` não vem): não em conta em perda (reverta antes),
 * não duas vezes, e não o que o BANCO confirmou (boleto pago no Inter: isso se resolve com o banco).
 */
export function motivoNaoEstornar(c: ContaPerda, r?: RecebimentoEstorno | null): string | null {
  if (c.excluidaEm) return "Esta conta foi excluída.";
  if (c.status === "PERDA") return "Conta em perda: reverta a perda antes de estornar.";
  if (c.status === "RENEGOCIADO") return "Conta renegociada: desfaça a renegociação antes de estornar.";
  if (r) {
    if (r.estornadoEm) return "Este recebimento já foi estornado.";
    if (r.origem === "BOLETO") return "Pago pelo boleto no banco: o estorno é com o banco, não aqui.";
    if (r.origem === "LEGADO") return "Este recebimento já foi estornado.";
    return null;
  }
  if (!temBaixaAntiga(c)) return "Escolha o recebimento a estornar.";
  if (c.boletoStatus === "PAGO") return "Pago pelo boleto no banco: o estorno é com o banco, não aqui.";
  return null;
}

/** Motivo de perda/estorno informado (tamanho mínimo) */
export const motivoTextoInvalido = (motivo: string | null | undefined, rotulo = "o motivo") =>
  (motivo ?? "").trim().length < MOTIVO_MINIMO ? `Informe ${rotulo}.` : null;

/** Rótulo de onde veio o recebimento (gaveta, linha do tempo) */
export const ORIGEM_RECEBIMENTO: Record<string, string> = {
  MANUAL: "Informado à mão", BOLETO: "Boleto Banco Inter", MEDICAO: "Pagamento da fatura/medição",
  RECUPERACAO: "Recuperação de perda", LEGADO: "Baixa antiga (antes do histórico)",
};

/** Doze meses para trás (o alerta de inadimplência no cadastro do cliente) */
export function inicioJanelaPerdas(agora = new Date()) {
  const d = new Date(agora);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}
