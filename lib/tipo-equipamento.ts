import { prisma } from "@/lib/prisma";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";

/**
 * Dual-write do tipo de equipamento: dado o enum `tipo` (campo legado), resolve
 * o FK canônico `tipoEquipamentoId` para o TipoEquipamentoCustom correspondente
 * (ancorado por `chaveEnum`). Cria o tipo padrão sob demanda — cobre empresas
 * criadas após o backfill inicial.
 */
export async function resolverTipoEquipamentoId(empresaId: string, tipoEnum: string): Promise<string | null> {
  if (!tipoEnum) return null;

  const existente = await prisma.tipoEquipamentoCustom.findFirst({
    where: { empresaId, chaveEnum: tipoEnum },
    select: { id: true },
  });
  if (existente) return existente.id;

  const nome = LABELS_TIPO_EQUIPAMENTO[tipoEnum as keyof typeof LABELS_TIPO_EQUIPAMENTO] ?? tipoEnum;
  const criado = await prisma.tipoEquipamentoCustom.create({
    data: { empresaId, nome, chaveEnum: tipoEnum },
    select: { id: true },
  });
  return criado.id;
}
