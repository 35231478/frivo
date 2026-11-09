/**
 * Cálculo de BTU da calculadora pública (regra pura, sem dependências — roda no cliente e no servidor,
 * e é testável). Fórmula de referência do setor (orientativa; o orçamento definitivo sai após visita):
 *   - base por m² conforme o tipo de ambiente (600 residencial … 900 galpão);
 *   - + 600 BTU por pessoa acima de 2 e + 600 BTU por aparelho que esquenta (TV, forno, servidores…);
 *   - + 10% quando o sol bate à tarde e + 10% quando é último andar/cobertura (carga térmica maior);
 * arredonda para a capacidade comercial mais próxima para cima (9k, 12k, 18k, 22k, 24k, 30k, 36k, 48k, 60k).
 * A base e os fatores pessoas/sol são os mesmos de sempre; aparelhos e cobertura são opcionais (padrão
 * sem efeito), para não mudar o resultado de quem não os informa.
 */

export type TipoAmbiente = "quarto" | "sala" | "cozinha" | "escritorio" | "loja" | "salao" | "galpao";

export const TIPOS_AMBIENTE: { valor: TipoAmbiente; rotulo: string; comercial: boolean; basePorM2: number }[] = [
  { valor: "quarto", rotulo: "Quarto", comercial: false, basePorM2: 600 },
  { valor: "sala", rotulo: "Sala / Cozinha", comercial: false, basePorM2: 600 },
  { valor: "cozinha", rotulo: "Cozinha", comercial: false, basePorM2: 700 },
  { valor: "escritorio", rotulo: "Escritório", comercial: true, basePorM2: 800 },
  { valor: "loja", rotulo: "Loja", comercial: true, basePorM2: 800 },
  { valor: "salao", rotulo: "Salão", comercial: true, basePorM2: 800 },
  { valor: "galpao", rotulo: "Galpão", comercial: true, basePorM2: 900 },
];

/** Capacidades comerciais de splits (BTU/h), em ordem. */
export const CAPACIDADES = [9000, 12000, 18000, 22000, 24000, 30000, 36000, 48000, 60000] as const;

/** Faixa de preço de referência do EQUIPAMENTO por capacidade (R$ min–max). Instalação é à parte. */
const PRECO_EQUIP: Record<number, [number, number]> = {
  9000: [2000, 2800], 12000: [2400, 3300], 18000: [3200, 4500], 22000: [3800, 5200],
  24000: [4000, 5600], 30000: [5200, 7200], 36000: [6000, 8500], 48000: [8000, 11000], 60000: [10000, 14000],
};

/** Forma física do equipamento recomendado — a cena ilustra cada uma de um jeito. */
export type FormaEquipamento = "hi-wall" | "piso-teto" | "cassete" | "multisplit" | "vrf";

export interface Equipamento {
  forma: FormaEquipamento;
  rotulo: string;
  /** Onde a unidade interna fica na cena: parede (alta), piso (baixa) ou teto (embutida) */
  posicao: "parede" | "piso" | "teto";
  /** Conjunto com unidade externa + várias internas (multisplit/VRF) */
  conjunto: boolean;
}

export interface EntradaAmbiente {
  nome: string;
  tipo: TipoAmbiente;
  areaM2: number;
  pessoas: number;
  solTarde: boolean;
  /** Aparelhos que esquentam (TV, forno, computadores…): +600 BTU cada. Opcional. */
  aparelhos?: number;
  /** Último andar / cobertura (telhado pega sol): +10%. Opcional. */
  cobertura?: boolean;
}

export interface ResultadoAmbiente {
  nome: string;
  areaM2: number;
  btuCalculado: number;
  btuRecomendado: number;
  comercial: boolean;
  tipoEquipamento: string;
  equipamento: Equipamento;
  justificativa: string;
  faixaPreco: [number, number];
}

function arredondarCapacidade(btu: number): number {
  for (const c of CAPACIDADES) if (btu <= c) return c;
  return CAPACIDADES[CAPACIDADES.length - 1];
}

/** O equipamento de UM ambiente, pela capacidade: parede (hi-wall) até piso-teto/cassete nos maiores. */
export function equipamentoDoAmbiente(btuRecomendado: number, comercial: boolean): Equipamento {
  if (btuRecomendado <= 18000) return { forma: "hi-wall", rotulo: "Split Hi-Wall Inverter", posicao: "parede", conjunto: false };
  if (btuRecomendado <= 36000) return comercial
    ? { forma: "cassete", rotulo: "Split Cassete (teto)", posicao: "teto", conjunto: false }
    : { forma: "piso-teto", rotulo: "Split Piso-Teto", posicao: "piso", conjunto: false };
  return { forma: "cassete", rotulo: "Split Cassete (teto)", posicao: "teto", conjunto: false };
}

export function calcularAmbiente(e: EntradaAmbiente): ResultadoAmbiente {
  const def = TIPOS_AMBIENTE.find((t) => t.valor === e.tipo);
  const comercial = def?.comercial ?? false;
  const basePorM2 = def?.basePorM2 ?? 600;
  const area = Math.max(0, Number(e.areaM2) || 0);
  const pessoas = Math.max(1, Math.round(Number(e.pessoas) || 1));
  const aparelhos = Math.max(0, Math.round(Number(e.aparelhos) || 0));
  let btu = area * basePorM2 + Math.max(0, pessoas - 2) * 600 + aparelhos * 600;
  if (e.solTarde) btu *= 1.1;
  if (e.cobertura) btu *= 1.1;
  const btuCalculado = Math.round(btu);
  const btuRecomendado = arredondarCapacidade(btuCalculado);
  const faixaPreco = PRECO_EQUIP[btuRecomendado] ?? [0, 0];
  const equipamento = equipamentoDoAmbiente(btuRecomendado, comercial);
  const extras = [
    `${area} m² (${comercial ? "comercial" : "residencial"})`,
    `${pessoas} pessoa(s)`,
    ...(aparelhos ? [`${aparelhos} aparelho(s)`] : []),
    ...(e.solTarde ? ["sol da tarde"] : []),
    ...(e.cobertura ? ["cobertura"] : []),
  ].join(", ");
  const justificativa = `${extras} → ${btuCalculado.toLocaleString("pt-BR")} BTU/h, recomendado ${btuRecomendado.toLocaleString("pt-BR")} BTU/h (${equipamento.rotulo}).`;
  return {
    nome: e.nome.trim() || "Ambiente",
    areaM2: area,
    btuCalculado,
    btuRecomendado,
    comercial,
    tipoEquipamento: equipamento.rotulo,
    equipamento,
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

/**
 * A recomendação do CONJUNTO (a cena mostra o todo): com vários ambientes ou grande porte, uma
 * unidade externa com várias internas (multisplit) — ou VRF para muitos ambientes/grande porte
 * comercial. Com um ambiente só, vale o equipamento dele.
 */
export function recomendarConjunto(ambientes: ResultadoAmbiente[]): Equipamento {
  const vivos = ambientes.filter((a) => a.btuRecomendado > 0);
  if (vivos.length <= 1) return vivos[0]?.equipamento ?? equipamentoDoAmbiente(9000, false);
  const totalBtu = vivos.reduce((s, a) => s + a.btuRecomendado, 0);
  const grande = vivos.length >= 5 || totalBtu >= 150000 || vivos.some((a) => a.comercial && a.btuRecomendado >= 48000);
  return grande
    ? { forma: "vrf", rotulo: `Sistema VRF (${vivos.length} ambientes)`, posicao: "teto", conjunto: true }
    : { forma: "multisplit", rotulo: `Multisplit (1 externa + ${vivos.length} internas)`, posicao: "parede", conjunto: true };
}
