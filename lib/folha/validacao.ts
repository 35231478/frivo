import { z } from "zod";
import { ADICIONAIS, REGIMES } from "@/lib/folha/calculo";

/** Valor em R$: vazio/null → null; aceita número ou texto ("1.234,56", "R$ 2.500"). */
export function lerValor(v: unknown): number | null | typeof NaN {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s) return null;
  // "1.234,56" (BR) → 1234.56; "1234.56" e "1234,56" também
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const num = Number(s);
  return Number.isFinite(num) ? num : NaN;
}

const valor = (max: number, msg: string) =>
  z.preprocess(lerValor, z.number({ invalid_type_error: msg }).min(0, msg).max(max, msg).nullable()).optional();
const inteiro = (min: number, max: number, msg: string) =>
  z.preprocess((v) => { const x = lerValor(v); return x == null || Number.isNaN(x) ? x : Math.round(x); },
    z.number({ invalid_type_error: msg }).int().min(min, msg).max(max, msg).nullable()).optional();

/** Seção "Dados financeiros / Folha" do colaborador (PUT /api/folha/colaboradores/[id]). */
export const folhaColaboradorSchema = z.object({
  regime: z.enum(REGIMES),
  salario: valor(1_000_000, "Salário inválido"),
  valorDiaria: valor(100_000, "Diária inválida"),
  diasMes: inteiro(0, 31, "Dias no mês: de 0 a 31"),
  horasMes: inteiro(1, 744, "Horas no mês: de 1 a 744"),
  adicionalTipo: z.enum(ADICIONAIS).default("NENHUM"),
  adicionalPercent: valor(100, "Percentual do adicional: de 0 a 100"),
  adicionalValor: valor(1_000_000, "Valor do adicional inválido"),
  horasExtrasValor: valor(1_000_000, "Horas extras inválidas"),
  valeTransporte: valor(100_000, "Vale-transporte inválido"),
  descontaVt: z.boolean().default(true),
  valeAlimentacao: valor(100_000, "VA/VR inválido"),
  planoSaude: valor(100_000, "Plano de saúde inválido"),
  outrosBeneficios: valor(100_000, "Outros benefícios inválidos"),
  descontos: valor(1_000_000, "Descontos inválidos"),
  descontosDescricao: z.string().trim().max(200).optional().nullable(),
  modeloEncargosId: z.string().max(40).optional().nullable(),
  observacoes: z.string().trim().max(1000).optional().nullable(),
}).strict();

export type FolhaColaboradorInput = z.infer<typeof folhaColaboradorSchema>;

/** Modelo de encargos (POST/PUT /api/folha/modelos). */
export const modeloEncargosSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").max(80),
  regime: z.enum(REGIMES),
  padrao: z.boolean().default(false),
  itens: z.array(z.object({
    nome: z.string().trim().min(1, "Nome do encargo obrigatório").max(80),
    percentual: z.preprocess(lerValor, z.number({ invalid_type_error: "Percentual inválido" }).min(0, "Percentual: de 0 a 100").max(100, "Percentual: de 0 a 100")),
  }).strict()).max(20, "No máximo 20 itens"),
}).strict();

export const itensEncargoSchema = modeloEncargosSchema.shape.itens;

/** Lê `itens` (JSON do banco) com segurança: formato inesperado → lista vazia. */
export function itensDoModelo(json: unknown) {
  const r = itensEncargoSchema.safeParse(json);
  return r.success ? r.data : [];
}
