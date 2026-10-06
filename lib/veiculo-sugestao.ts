/**
 * Veículo puxado automaticamente na atividade da OS (regra única, usada na tela e no servidor):
 * - escolheu uma EQUIPE → o veículo da equipe (o 1º ativo, por placa, se houver mais de um);
 * - escolheu colaborador(es) → o veículo padrão do RESPONSÁVEL (`tecnicos.veiculo_id`);
 * - sem vínculo (ou veículo inativo) → vazio. Veículo nunca é obrigatório.
 */
export interface VeiculoResumo {
  id: string;
  placa: string;
  modelo: string;
  marca?: string | null;
  status: string;
  equipeId: string | null;
}

export type OrigemVeiculo = "equipe" | "colaborador" | null;

export function rotuloVeiculo(v: Pick<VeiculoResumo, "placa" | "modelo" | "marca">) {
  return `${v.placa} — ${[v.marca, v.modelo].filter(Boolean).join(" ")}`.trim();
}

export function sugerirVeiculo(
  exec: { equipeId: string | null; responsavelId: string | null },
  veiculos: VeiculoResumo[],
  veiculoDoColaborador: (tecnicoId: string) => string | null | undefined,
): { veiculoId: string | null; origem: OrigemVeiculo } {
  const ativos = veiculos.filter((v) => v.status === "ATIVO");
  if (exec.equipeId) {
    const daEquipe = ativos.filter((v) => v.equipeId === exec.equipeId).sort((a, b) => a.placa.localeCompare(b.placa));
    return daEquipe[0] ? { veiculoId: daEquipe[0].id, origem: "equipe" } : { veiculoId: null, origem: null };
  }
  if (exec.responsavelId) {
    const id = veiculoDoColaborador(exec.responsavelId);
    if (id && ativos.some((v) => v.id === id)) return { veiculoId: id, origem: "colaborador" };
  }
  return { veiculoId: null, origem: null };
}
