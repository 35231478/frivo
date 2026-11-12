import { prisma } from "@/lib/prisma";

/**
 * Vínculo equipe ↔ veículos ao salvar a equipe. Antes, salvar a equipe desvinculava
 * TODOS os veículos dela e religava só o escolhido — uma equipe com 2 veículos perdia
 * um sem aviso. Agora:
 * - sem `veiculoIds` no corpo: os veículos não são tocados;
 * - com `veiculoIds`: vincula os novos (movendo de outra equipe, se for o caso) e só
 *   desvincula os que saíram se `confirmarDesvinculo` vier true — senão devolve a lista
 *   para a tela pedir confirmação.
 */
export async function planejarVeiculosEquipe(empresaId: string, equipeId: string | null, d: { veiculoIds?: string[]; veiculoId?: string | null }) {
  if (d.veiculoIds === undefined) {
    // Legado: um veículo escolhido só é acrescentado
    const ids = d.veiculoId ? [d.veiculoId] : [];
    return { vincular: ids, desvincular: [] as { id: string; placa: string }[] };
  }
  const desejados = [...new Set(d.veiculoIds)];
  const validos = desejados.length
    ? (await prisma.veiculo.findMany({ where: { id: { in: desejados }, empresaId }, select: { id: true } })).map((v) => v.id)
    : [];
  if (validos.length !== desejados.length) throw new Error("Veículo inválido.");
  const atuais = equipeId ? await prisma.veiculo.findMany({ where: { empresaId, equipeId }, select: { id: true, placa: true } }) : [];
  return { vincular: validos, desvincular: atuais.filter((v) => !validos.includes(v.id)) };
}

export async function aplicarVeiculosEquipe(empresaId: string, equipeId: string, plano: { vincular: string[]; desvincular: { id: string }[] }) {
  if (plano.desvincular.length)
    await prisma.veiculo.updateMany({ where: { empresaId, id: { in: plano.desvincular.map((v) => v.id) } }, data: { equipeId: null } });
  if (plano.vincular.length)
    await prisma.veiculo.updateMany({ where: { empresaId, id: { in: plano.vincular } }, data: { equipeId } });
}

/** Membros e líder precisam ser colaboradores da MESMA empresa. */
export async function validarPessoasEquipe(empresaId: string, membroIds: string[], liderId?: string | null) {
  const ids = [...new Set([...membroIds, ...(liderId ? [liderId] : [])])];
  if (!ids.length) return true;
  const n = await prisma.tecnico.count({ where: { id: { in: ids }, empresaId } });
  return n === ids.length;
}
