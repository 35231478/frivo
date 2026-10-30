import { ratearDesconto } from "@/lib/nfse/nota";

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

/** O que o cadastro do serviço diz sobre as retenções (caixinha "reter" + alíquota do serviço) */
export interface RetencoesDoServico {
  issRetido?: boolean | null; aliquotaISS?: unknown;
  retIr?: boolean | null; aliquotaIR?: unknown;
  retPis?: boolean | null; aliquotaPIS?: unknown;
  retCofins?: boolean | null; aliquotaCOFINS?: unknown;
  retCsll?: boolean | null; aliquotaCSLL?: unknown;
  retInss?: boolean | null; aliquotaINSS?: unknown;
}

/** Select do Prisma com o que o cadastro do serviço diz sobre as retenções */
export const SELECT_RETENCOES_SERVICO = {
  id: true, issRetido: true, aliquotaISS: true, retIr: true, aliquotaIR: true, retPis: true, aliquotaPIS: true,
  retCofins: true, aliquotaCOFINS: true, retCsll: true, aliquotaCSLL: true, retInss: true, aliquotaINSS: true,
} as const;

/** Retenção → caixinha e alíquota no cadastro do serviço */
export const RETENCAO_NO_SERVICO = {
  iss: { reter: "issRetido", aliquota: "aliquotaISS" },
  ir: { reter: "retIr", aliquota: "aliquotaIR" },
  pis: { reter: "retPis", aliquota: "aliquotaPIS" },
  cofins: { reter: "retCofins", aliquota: "aliquotaCOFINS" },
  csll: { reter: "retCsll", aliquota: "aliquotaCSLL" },
  inss: { reter: "retInss", aliquota: "aliquotaINSS" },
} as const satisfies Record<ChaveRetencao, { reter: keyof RetencoesDoServico; aliquota: keyof RetencoesDoServico }>;

const aliquotaValida = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * Retenções herdadas dos serviços da nota: uma retenção vale quando TODOS os serviços com valor a
 * marcam no cadastro ("reter"), com a alíquota do serviço (ISS sem alíquota = a da empresa). Se só
 * parte dos serviços marca, ela fica de fora e vai em `parciais` (o usuário confere no "Editar").
 */
export function retencoesDosServicos(
  itens: { tipo?: string; valorTotal: number; servico?: RetencoesDoServico | null }[],
  aliquotaIssPadrao: number | null,
): { retencoes: Retencoes; parciais: ChaveRetencao[]; aliquotas: Retencoes } {
  const servicos = itens.filter((i) => (i.tipo ?? "SERVICO") === "SERVICO" && i.valorTotal > 0);
  const retencoes: Retencoes = {};
  const aliquotas: Retencoes = {};
  const parciais: ChaveRetencao[] = [];
  for (const def of RETENCOES) {
    const no = RETENCAO_NO_SERVICO[def.chave];
    const retidos = servicos.filter((i) => i.servico?.[no.reter] === true);
    // Alíquota: a dos serviços que retêm; para o editor, na falta, a de qualquer serviço da nota
    const de = (l: typeof servicos) => l.map((i) => aliquotaValida(i.servico?.[no.aliquota])).find((a) => a != null);
    const aliquota = de(retidos) ?? de(servicos) ?? (def.chave === "iss" ? aliquotaValida(aliquotaIssPadrao) : null);
    retencoes[def.chave] = null;
    aliquotas[def.chave] = aliquota;
    if (!retidos.length) continue;
    if (retidos.length < servicos.length) { parciais.push(def.chave); continue; }
    retencoes[def.chave] = aliquota;
  }
  return { retencoes, parciais, aliquotas };
}

/** Cadastro do serviço: "reter" marcado exige a alíquota (o ISS pode herdar a da empresa) */
export function motivoRetencaoServicoInvalida(s: RetencoesDoServico): string | null {
  for (const def of RETENCOES) {
    if (def.chave === "iss") continue;
    const no = RETENCAO_NO_SERVICO[def.chave];
    if (s[no.reter] === true && aliquotaValida(s[no.aliquota]) == null) return `Informe a alíquota de ${def.rotulo} para reter (ou desmarque).`;
  }
  return null;
}

/** "ISS retido 5% (−R$ 140,00)" — o resumo de uma linha do faturamento */
export function resumoRetencoes(d: Detalhamento, moeda: (v: number) => string): string {
  return d.linhas.map((l) => `${l.rotulo} ${String(l.aliquota).replace(".", ",")}% (−${moeda(l.valor)})`).join(" · ");
}

/**
 * Base das retenções = o valor da NFS-e: os serviços, já com a parte deles no desconto (rateado
 * como na nota — ratearDesconto). Produto não entra na nota nem na retenção. Sem produto, é o
 * próprio valor líquido da medição (como sempre foi).
 */
export function baseRetencoes(m: { valorTotal: unknown; valorLiquido: unknown; itens: { tipo?: string | null; valorTotal: unknown }[] }): number {
  if (!m.itens.some((i) => i.tipo === "PRODUTO")) return Number(m.valorLiquido);
  const valores = m.itens.map((i) => Number(i.valorTotal));
  const descontos = ratearDesconto(valores, Number(m.valorTotal) - Number(m.valorLiquido));
  const c = m.itens.reduce((s, i, k) => ((i.tipo ?? "SERVICO") === "SERVICO" ? s + Math.round(valores[k] * 100) - Math.round(descontos[k] * 100) : s), 0);
  return Math.max(c, 0) / 100;
}
