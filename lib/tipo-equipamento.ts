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
 * Escolha NOVA precisa ser de tipo ATIVO (mesma regra do SeletorCadastro); `atual` = o
 * tipoEquipamentoId que o equipamento já tem, aceito mesmo inativo.
 */
export async function resolverTipoEquipamento(
  empresaId: string,
  tipoEnum: string,
  tipoEquipamentoId?: string | null,
  atual?: string | null,
): Promise<{ tipo: string; tipoEquipamentoId: string | null } | { erro: string }> {
  const inativoNovo = (t: { id: string; ativo: boolean }) => !t.ativo && t.id !== atual;
  const ERRO_INATIVO = { erro: "Tipo de equipamento inativo: escolha um ativo." };
  if (tipoEquipamentoId) {
    const custom = await prisma.tipoEquipamentoCustom.findFirst({
      where: { id: tipoEquipamentoId, empresaId },
      select: { id: true, chaveEnum: true, ativo: true },
    });
    if (!custom) return { erro: "Tipo de equipamento não encontrado" };
    if (inativoNovo(custom)) return ERRO_INATIVO;
    return { tipo: custom.chaveEnum ?? "OUTRO", tipoEquipamentoId: custom.id };
  }
  if (!tipoEnum) return { tipo: tipoEnum, tipoEquipamentoId: null };
  const padrao = await prisma.tipoEquipamentoCustom.findFirst({ where: { empresaId, chaveEnum: tipoEnum }, select: { id: true, ativo: true } });
  if (padrao && inativoNovo(padrao)) return ERRO_INATIVO;
  return { tipo: tipoEnum, tipoEquipamentoId: padrao?.id ?? await resolverTipoEquipamentoId(empresaId, tipoEnum) };
}
