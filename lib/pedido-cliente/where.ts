/**
 * PEDIDO DO CLIENTE — os `where` de "Aguardando pedido" (puros: sem o Prisma Client, para o filtro das listas em
 * lib/listas/filtros). A regra item a item está em ./regra; estes são a mesma regra escrita para o banco.
 */
import type { Prisma } from "@prisma/client";
import type { ModoPedido } from "@/lib/pedido-cliente/regra";

/** O valor do filtro na URL das listas: ?pedido=aguardando */
export const FILTRO_AGUARDANDO_PEDIDO = "aguardando";

/** A fatura já saiu: a OS/orçamento não espera mais pedido (inclusive a do jeito antigo, com o PC na própria fatura) */
export const FATURAS_EMITIDAS = ["NF_EMITIDA", "BOLETO_GERADO", "PAGO"] as const;
const naFaturaEmitida = { medicao: { OR: [{ status: { in: [...FATURAS_EMITIDAS] } }, { pcNumero: { not: null }, status: { not: "CANCELADA" as const } }] } };

/** O modo da unidade/cliente no `where` (os modos pedidos) */
function whereModo(modos: ModoPedido[]) {
  const doCliente = modos.includes("FATURAR") ? { cliente: { exigePcAntesNf: true } } : { cliente: { exigePcAntesNf: true, exigePedidoExecutar: true } };
  return {
    OR: [
      { unidade: { exigePedido: { in: modos } } },
      { AND: [{ OR: [{ unidadeId: null }, { unidade: { exigePedido: null } }] }, doCliente] },
    ],
  };
}

/** OS "Aguardando pedido" (sem a empresa: quem chama junta) */
export function whereOsAguardando(modos: ModoPedido[] = ["FATURAR", "EXECUTAR"]): Prisma.OrdemServicoWhereInput {
  return {
    status: { not: "CANCELADA" }, pedidoClienteId: null, pedidoLiberadoEm: null,
    medicaoItens: { none: naFaturaEmitida },
    AND: [whereModo(modos)],
  } as Prisma.OrdemServicoWhereInput;
}

/** Orçamentos aprovados "Aguardando pedido" */
export function whereOrcamentoAguardando(): Prisma.OrcamentoWhereInput {
  return {
    status: "APROVADO", pedidoClienteId: null, pedidoLiberadoEm: null,
    medicaoItens: { none: naFaturaEmitida },
    // a OS gerada dele já foi faturada (ou tem pedido): ele não espera mais
    NOT: { osGerada: { OR: [{ pedidoClienteId: { not: null } }, { pedidoLiberadoEm: { not: null } }, { medicaoItens: { some: naFaturaEmitida } }] } },
    AND: [whereModo(["FATURAR", "EXECUTAR"])],
  } as Prisma.OrcamentoWhereInput;
}


/** Faturas (medições) esperando o pedido do cliente: "Aguardando PC", ou alguma OS/orçamento dela aguardando */
export function whereMedicaoAguardando(): Prisma.MedicaoWhereInput {
  return {
    status: { notIn: ["CANCELADA", ...FATURAS_EMITIDAS] },
    OR: [
      { status: "AGUARDANDO_PC" },
      { itens: { some: { OR: [{ ordemServico: whereOsAguardando() }, { orcamento: whereOrcamentoAguardando() }] } } },
    ],
  } as Prisma.MedicaoWhereInput;
}
