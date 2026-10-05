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

/**
 * Resolve o par (tipo enum, tipoEquipamentoId) a gravar no equipamento.
 * - Com `tipoEquipamentoId` (tipo personalizado, ex.: criado no cadastro rápido):
 *   valida a empresa e usa `chaveEnum` do tipo — ou OUTRO quando é um tipo novo.
 * - Sem ele: comportamento de sempre (resolve a partir do enum).
 */
export async function resolverTipoEquipamento(
  empresaId: string,
  tipoEnum: string,
  tipoEquipamentoId?: string | null,
): Promise<{ tipo: string; tipoEquipamentoId: string | null } | null> {
  if (tipoEquipamentoId) {
    const custom = await prisma.tipoEquipamentoCustom.findFirst({
      where: { id: tipoEquipamentoId, empresaId },
      select: { id: true, chaveEnum: true },
    });
    if (!custom) return null;
    return { tipo: custom.chaveEnum ?? "OUTRO", tipoEquipamentoId: custom.id };
  }
  return { tipo: tipoEnum, tipoEquipamentoId: await resolverTipoEquipamentoId(empresaId, tipoEnum) };
}
