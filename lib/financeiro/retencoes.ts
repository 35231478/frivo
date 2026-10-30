/**
 * Retenções na fonte do faturamento (medição): ISS retido + IR, PIS, COFINS, CSLL e INSS opcionais.
 * Quem marca é o usuário (nada é marcado sozinho no banco). A base é o valor dos serviços da nota
 * (valorLiquido da medição, já com desconto). Cada retenção = base × alíquota, arredondada no centavo;
 * a conta a receber/boleto sai pelo líquido = base − soma das retenções marcadas.
 */
export const RETENCOES = [
  { chave: "iss", campo: "retIssAliquota", rotulo: "ISS retido" },
  { chave: "ir", campo: "retIrAliquota", rotulo: "IR" },
  { chave: "pis", campo: "retPisAliquota", rotulo: "PIS" },
  { chave: "cofins", campo: "retCofinsAliquota", rotulo: "COFINS" },
  { chave: "csll", campo: "retCsllAliquota", rotulo: "CSLL" },
  { chave: "inss", campo: "retInssAliquota", rotulo: "INSS" },
] as const;

export type ChaveRetencao = (typeof RETENCOES)[number]["chave"];
export type CampoRetencao = (typeof RETENCOES)[number]["campo"];
/** Alíquota (%) por retenção; null/ausente = desmarcada */
export type Retencoes = Partial<Record<ChaveRetencao, number | null>>;

export interface LinhaRetencao { chave: ChaveRetencao; rotulo: string; aliquota: number; valor: number }
export interface Detalhamento { bruto: number; linhas: LinhaRetencao[]; total: number; liquido: number }

const centavos = (v: number) => Math.round(v * 100);

/** Bruto, cada retenção marcada e o líquido a receber */
export function calcularRetencoes(base: number, r: Retencoes): Detalhamento {
  const b = centavos(base);
  const linhas: LinhaRetencao[] = [];
  for (const def of RETENCOES) {
    const a = r[def.chave];
    if (a == null) continue;
    linhas.push({ chave: def.chave, rotulo: def.rotulo, aliquota: a, valor: Math.round((b * a) / 100) / 100 });
  }
  const total = linhas.reduce((s, l) => s + centavos(l.valor), 0);
  return { bruto: b / 100, linhas, total: total / 100, liquido: (b - total) / 100 };
}

/** O que está gravado na medição (Decimal/number/null) → alíquotas por chave */
export function retencoesDaMedicao(m: Partial<Record<CampoRetencao, unknown>>): Retencoes {
  const r: Retencoes = {};
  for (const def of RETENCOES) {
    const v = m[def.campo];
    r[def.chave] = v == null ? null : Number(v);
  }
  return r;
}

/** Alíquotas → colunas da medição (desmarcada = null) */
export function camposDaMedicao(r: Retencoes): Record<CampoRetencao, number | null> {
  return Object.fromEntries(RETENCOES.map((d) => [d.campo, r[d.chave] ?? null])) as Record<CampoRetencao, number | null>;
}

/** Recusa alíquota fora de (0, 100] e retenção maior que o valor da nota */
export function motivoRetencaoInvalida(base: number, r: Retencoes): string | null {
  for (const def of RETENCOES) {
    const a = r[def.chave];
    if (a == null) continue;
    if (!Number.isFinite(a) || a <= 0) return `Informe a alíquota de ${def.rotulo} (ou desmarque).`;
    if (a > 100) return `Alíquota de ${def.rotulo} acima de 100%.`;
  }
  if (calcularRetencoes(base, r).liquido < 0) return "As retenções passam do valor da nota.";
  return null;
}

/**
 * Sugestão do ISS conforme a nota: os serviços com valor da medição estão TODOS como "ISS retido"
 * no cadastro (o que vai para a NFS-e) → a tela já mostra o ISS marcado, com a alíquota do serviço
 * (ou a padrão da empresa). O usuário confirma salvando — e pode desmarcar. Federais: sempre
 * desmarcados (padrão Simples Nacional).
 */
export function sugestaoIss(
  itens: { tipo?: string; valorTotal: number; servico?: { issRetido?: boolean | null; aliquotaISS?: number | null } | null }[],
  aliquotaPadrao: number | null,
): { marcar: boolean; aliquota: number | null; parcial: boolean } {
  const servicos = itens.filter((i) => (i.tipo ?? "SERVICO") === "SERVICO" && i.valorTotal > 0);
  const retidos = servicos.filter((i) => i.servico?.issRetido);
  if (!retidos.length) return { marcar: false, aliquota: null, parcial: false };
  const aliquota = retidos.map((i) => i.servico?.aliquotaISS).find((a) => a != null && a > 0) ?? aliquotaPadrao ?? null;
  const todos = retidos.length === servicos.length;
  return { marcar: todos, aliquota: aliquota != null ? Number(aliquota) : null, parcial: !todos };
}
