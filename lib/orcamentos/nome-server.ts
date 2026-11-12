import { prisma } from "@/lib/prisma";
import { nomeFinalOrcamento, rotuloEquipamentoNome, type ContextoNomeOrcamento } from "./nome";

/**
 * Contexto do nome automático no servidor (sempre da empresa da sessão): cliente, e da 1ª OS
 * vinculada o tipo, a unidade e o equipamento principal (o da OS ou o 1º atendido).
 */
export async function contextoNomeOrcamento(
  empresaId: string, clienteId: string, ordensServicoIds: string[], itens: string[],
): Promise<ContextoNomeOrcamento> {
  const [cliente, os] = await Promise.all([
    prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { nome: true, nomeFantasia: true } }),
    ordensServicoIds.length
      ? prisma.ordemServico.findFirst({ where: { id: ordensServicoIds[0], empresaId }, select: contextoOsSelect })
      : Promise.resolve(null),
  ]);
  return { ...contextoDaOsParaNome(os), cliente: cliente?.nomeFantasia || cliente?.nome || null, itens };
}

/** O que a OS precisa trazer para o nome (também usado na tela, via form-dados) */
export const contextoOsSelect = {
  unidade: { select: { nome: true } },
  equipamento: { select: { nome: true, marca: true, modelo: true } },
  atividades: {
    orderBy: { criadoEm: "asc" as const },
    select: {
      tipoOs: { select: { nome: true } },
      equipamentos: { take: 1, select: { equipamento: { select: { nome: true, marca: true, modelo: true } } } },
    },
  },
};

type OsParaNome = {
  unidade: { nome: string } | null;
  equipamento: { nome: string | null; marca: string; modelo: string } | null;
  atividades: { tipoOs: { nome: string } | null; equipamentos: { equipamento: { nome: string | null; marca: string; modelo: string } }[] }[];
} | null;

export function contextoDaOsParaNome(os: OsParaNome): Omit<ContextoNomeOrcamento, "cliente" | "itens"> {
  if (!os) return {};
  const equip = os.equipamento ?? os.atividades.find((a) => a.equipamentos.length)?.equipamentos[0].equipamento ?? null;
  return {
    tipoOs: os.atividades.find((a) => a.tipoOs)?.tipoOs?.nome ?? null,
    unidade: os.unidade?.nome ?? null,
    equipamento: rotuloEquipamentoNome(equip) || null,
  };
}

/** O nome que vai para o banco: o digitado, ou o automático (mesma regra da prévia na tela) */
export async function nomeDoOrcamento(
  empresaId: string,
  data: { nome?: string | null; clienteId: string; ordensServicoIds: string[]; servicos: { descricao: string }[]; produtos: { descricao: string }[] },
) {
  const digitado = data.nome?.trim();
  if (digitado) return digitado;
  const itens = [...data.servicos, ...data.produtos].map((i) => i.descricao);
  return nomeFinalOrcamento(null, await contextoNomeOrcamento(empresaId, data.clienteId, data.ordensServicoIds, itens));
}
