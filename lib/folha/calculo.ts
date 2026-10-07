/**
 * Custo de Pessoal — cálculo de GESTÃO (estimativa do custo mensal da empresa por colaborador).
 * Não é folha oficial: não calcula INSS/FGTS/IRRF do empregado para fins legais, não gera holerite.
 * Arquivo puro (sem Prisma), usado no servidor, na tela e nos testes.
 *
 * Custo total = remuneração (base + adicional + horas extras) + encargos + benefícios − descontos
 *   - encargos = remuneração × soma dos percentuais do modelo de encargos do regime;
 *   - desconto de VT (só CLT): até 6% da base, limitado ao valor do VT.
 */

export const REGIMES = ["CLT", "PJ", "DIARISTA", "AUTONOMO"] as const;
export type Regime = (typeof REGIMES)[number];

export const REGIME_LABEL: Record<Regime, string> = {
  CLT: "CLT", PJ: "PJ", DIARISTA: "Diarista", AUTONOMO: "Autônomo",
};

export const ADICIONAIS = ["NENHUM", "INSALUBRIDADE", "PERICULOSIDADE"] as const;
export type Adicional = (typeof ADICIONAIS)[number];

export const ADICIONAL_LABEL: Record<Adicional, string> = {
  NENHUM: "Nenhum", INSALUBRIDADE: "Insalubridade", PERICULOSIDADE: "Periculosidade",
};

export const AVISO_GESTAO = "Ferramenta de gestão: estima o custo de pessoal da empresa. Não substitui a folha oficial nem o contador (não gera holerite, não calcula INSS/FGTS/IRRF para fins legais, não envia eSocial).";

export interface ItemEncargo { nome: string; percentual: number }

/** Funções que entram no "custo-hora médio dos técnicos" (insumo da margem das OS). */
export const FUNCOES_CUSTO_HORA = ["TECNICO_CAMPO", "RESPONSAVEL_TECNICO"];

export const HORAS_MES_PADRAO = 220; // CLT 44h semanais
export const DESCONTO_VT_MAX = 0.06;

/** Modelos criados para a empresa na primeira vez — percentuais de referência, AJUSTAR com o contador. */
export const MODELOS_PADRAO: { nome: string; regime: Regime; itens: ItemEncargo[] }[] = [
  {
    nome: "CLT (padrão)", regime: "CLT", itens: [
      { nome: "INSS patronal", percentual: 20 },
      { nome: "RAT/SAT", percentual: 2 },
      { nome: "Terceiros (Sistema S, salário-educação)", percentual: 5.8 },
      { nome: "FGTS", percentual: 8 },
      { nome: "Provisão 13º salário", percentual: 8.33 },
      { nome: "Provisão férias + 1/3", percentual: 11.11 },
    ],
  },
  { nome: "PJ (padrão)", regime: "PJ", itens: [] },
  { nome: "Diarista (padrão)", regime: "DIARISTA", itens: [] },
  { nome: "Autônomo (padrão)", regime: "AUTONOMO", itens: [{ nome: "INSS patronal sobre RPA", percentual: 20 }] },
];

/** Dados que entram no cálculo (já convertidos para número). Campos vazios = 0. */
export interface DadosFolha {
  regime: Regime;
  salario?: number | null;
  valorDiaria?: number | null;
  diasMes?: number | null;
  horasMes?: number | null;
  adicionalTipo?: Adicional | null;
  adicionalPercent?: number | null;
  adicionalValor?: number | null;
  horasExtrasValor?: number | null;
  valeTransporte?: number | null;
  descontaVt?: boolean | null;
  valeAlimentacao?: number | null;
  planoSaude?: number | null;
  outrosBeneficios?: number | null;
  descontos?: number | null;
}

export interface CustoColaborador {
  base: number;
  adicional: number;
  horasExtras: number;
  remuneracao: number;
  percentualEncargos: number;
  encargos: number;
  encargosItens: { nome: string; percentual: number; valor: number }[];
  beneficios: number;
  descontoVt: number;
  outrosDescontos: number;
  descontos: number;
  total: number;
  horasMes: number;
  custoHora: number;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
export const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function somaPercentuais(itens: ItemEncargo[]) {
  return centavos(itens.reduce((s, i) => s + n(i.percentual), 0));
}

/** Salário/base do mês: diarista = diária × dias; demais = salário mensal. */
export function baseMensal(d: Pick<DadosFolha, "regime" | "salario" | "valorDiaria" | "diasMes">) {
  if (d.regime === "DIARISTA" && n(d.valorDiaria) > 0) return centavos(n(d.valorDiaria) * n(d.diasMes));
  return centavos(n(d.salario));
}

/** Horas pagas no mês: informada; senão diarista = dias × 8h; demais = 220h. */
export function horasDoMes(d: Pick<DadosFolha, "regime" | "horasMes" | "diasMes">) {
  if (n(d.horasMes) > 0) return Math.round(n(d.horasMes));
  if (d.regime === "DIARISTA" && n(d.diasMes) > 0) return Math.round(n(d.diasMes) * 8);
  return HORAS_MES_PADRAO;
}

export function calcularCusto(d: DadosFolha, itensEncargo: ItemEncargo[]): CustoColaborador {
  const base = baseMensal(d);
  const adicional = !d.adicionalTipo || d.adicionalTipo === "NENHUM"
    ? 0
    : n(d.adicionalValor) > 0 ? centavos(n(d.adicionalValor)) : centavos(base * n(d.adicionalPercent) / 100);
  const horasExtras = centavos(n(d.horasExtrasValor));
  const remuneracao = centavos(base + adicional + horasExtras);

  const encargosItens = itensEncargo
    .filter((i) => n(i.percentual) > 0)
    .map((i) => ({ nome: i.nome, percentual: n(i.percentual), valor: centavos(remuneracao * n(i.percentual) / 100) }));
  const encargos = centavos(encargosItens.reduce((s, i) => s + i.valor, 0));

  const vt = n(d.valeTransporte);
  const beneficios = centavos(vt + n(d.valeAlimentacao) + n(d.planoSaude) + n(d.outrosBeneficios));
  // Desconto de VT do empregado (CLT): até 6% do salário-base, nunca mais que o próprio VT
  const descontoVt = d.regime === "CLT" && d.descontaVt !== false && vt > 0 ? centavos(Math.min(vt, base * DESCONTO_VT_MAX)) : 0;
  const outrosDescontos = centavos(n(d.descontos));
  const descontos = centavos(descontoVt + outrosDescontos);

  const total = centavos(Math.max(0, remuneracao + encargos + beneficios - descontos));
  const horasMes = horasDoMes(d);
  return {
    base, adicional, horasExtras, remuneracao,
    percentualEncargos: somaPercentuais(itensEncargo), encargos, encargosItens,
    beneficios, descontoVt, outrosDescontos, descontos,
    total, horasMes, custoHora: horasMes > 0 ? centavos(total / horasMes) : 0,
  };
}

/** "2026-10" ← data (fuso de Brasília). */
export function competenciaDe(ano: number, mes0: number) {
  return `${ano}-${String(mes0 + 1).padStart(2, "0")}`;
}

export function competenciaValida(c: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(c);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 2000 && +m[1] <= 2100;
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function rotuloCompetencia(c: string, longo = false) {
  const [a, m] = c.split("-");
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return longo ? `${MESES[+m - 1]} de ${a}` : `${MESES_CURTOS[+m - 1]}/${a.slice(2)}`;
}

export function competenciaAnterior(c: string, meses = 1) {
  const [a, m] = c.split("-").map(Number);
  const t = a * 12 + (m - 1) - meses;
  return competenciaDe(Math.floor(t / 12), t % 12);
}
