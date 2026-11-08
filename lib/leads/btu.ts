/**
 * Cálculo de BTU da calculadora pública (regra pura, sem dependências — roda no cliente e no servidor,
 * e é testável). Fórmula de referência do setor (orientativa; o orçamento definitivo sai após visita):
 *   - base por m²: 600 BTU/m² (residencial) ou 800 BTU/m² (comercial);
 *   - + 600 BTU por pessoa acima de 2 no ambiente;
 *   - + 10% quando o sol bate à tarde (carga térmica maior);
 * arredonda para a capacidade comercial mais próxima para cima (9k, 12k, 18k, 22k, 24k, 30k, 36k, 48k, 60k).
 */

export type TipoAmbiente = "quarto" | "sala" | "escritorio" | "loja";

export const TIPOS_AMBIENTE: { valor: TipoAmbiente; rotulo: string; comercial: boolean }[] = [
  { valor: "quarto", rotulo: "Quarto", comercial: false },
  { valor: "sala", rotulo: "Sala / Cozinha", comercial: false },
  { valor: "escritorio", rotulo: "Escritório", comercial: true },
  { valor: "loja", rotulo: "Loja / Comercial", comercial: true },
];

/** Capacidades comerciais de splits (BTU/h), em ordem. */
export const CAPACIDADES = [9000, 12000, 18000, 22000, 24000, 30000, 36000, 48000, 60000] as const;

/** Faixa de preço de referência do EQUIPAMENTO por capacidade (R$ min–max). Instalação é à parte. */
const PRECO_EQUIP: Record<number, [number, number]> = {
  9000: [2000, 2800], 12000: [2400, 3300], 18000: [3200, 4500], 22000: [3800, 5200],
  24000: [4000, 5600], 30000: [5200, 7200], 36000: [6000, 8500], 48000: [8000, 11000], 60000: [10000, 14000],
};

export interface EntradaAmbiente {
  nome: string;
  tipo: TipoAmbiente;
  areaM2: number;
  pessoas: number;
  solTarde: boolean;
}

export interface ResultadoAmbiente {
  nome: string;
  areaM2: number;
  btuCalculado: number;
  btuRecomendado: number;
  tipoEquipamento: string;
  justificativa: string;
  faixaPreco: [number, number];
}

function arredondarCapacidade(btu: number): number {
  for (const c of CAPACIDADES) if (btu <= c) return c;
  return CAPACIDADES[CAPACIDADES.length - 1];
}

export function calcularAmbiente(e: EntradaAmbiente): ResultadoAmbiente {
  const comercial = TIPOS_AMBIENTE.find((t) => t.valor === e.tipo)?.comercial ?? false;
  const area = Math.max(0, Number(e.areaM2) || 0);
  const pessoas = Math.max(1, Math.round(Number(e.pessoas) || 1));
  const basePorM2 = comercial ? 800 : 600;
  let btu = area * basePorM2 + Math.max(0, pessoas - 2) * 600;
  if (e.solTarde) btu *= 1.1;
  const btuCalculado = Math.round(btu);
  const btuRecomendado = arredondarCapacidade(btuCalculado);
  const faixaPreco = PRECO_EQUIP[btuRecomendado] ?? [0, 0];
  const justificativa = `${area} m² (${comercial ? "comercial" : "residencial"}), ${pessoas} pessoa(s)${e.solTarde ? ", sol da tarde" : ""} → ${btuCalculado.toLocaleString("pt-BR")} BTU/h, recomendado ${btuRecomendado.toLocaleString("pt-BR")} BTU/h.`;
  return {
    nome: e.nome.trim() || "Ambiente",
    areaM2: area,
    btuCalculado,
    btuRecomendado,
    tipoEquipamento: "Split Hi-Wall Inverter",
    justificativa,
    faixaPreco,
  };
}

/** Pré-orçamento (só equipamentos) somando os ambientes. */
export function preOrcamento(ambientes: ResultadoAmbiente[]): { totalMin: number; totalMax: number } {
  return ambientes.reduce(
    (acc, a) => ({ totalMin: acc.totalMin + a.faixaPreco[0], totalMax: acc.totalMax + a.faixaPreco[1] }),
    { totalMin: 0, totalMax: 0 },
  );
}
