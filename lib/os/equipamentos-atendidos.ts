/**
 * Quantos equipamentos foram ATENDIDOS na OS — regra PURA, a mesma no relatório, no card da aba
 * "Relatórios & Anexos" e no cabeçalho da OS: equipamento DISTINTO marcado como atendido em
 * atividade não cancelada (atendido em duas atividades conta uma vez); e, em OS antiga concluída
 * sem nenhum equipamento vinculado, o equipamento principal. Nunca "todos os da unidade".
 * Arquivo puro: serve no servidor e na tela.
 */
export function contarEquipamentosAtendidos(
  ativs: { status: string; equipamentos: { feito: boolean; equipamento: { id: string } }[] }[],
  principalId: string | null = null, legado = false,
): number {
  const vinculados = new Set<string>();
  const atendidos = new Set<string>();
  for (const a of ativs) for (const v of a.equipamentos) {
    vinculados.add(v.equipamento.id);
    if (v.feito && a.status !== "CANCELADA") atendidos.add(v.equipamento.id);
  }
  if (principalId && legado && vinculados.size === 0) atendidos.add(principalId);
  return atendidos.size;
}
