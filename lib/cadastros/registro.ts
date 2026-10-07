import { z } from "zod";
import type { Acao } from "@/lib/permissoes";

/**
 * Cadastros padronizados — registro DECLARATIVO (mesmo espírito do ENTIDADE das ações em massa).
 * Puro (sem Prisma): usado pela tela (CadastroPadrao/SeletorCadastro) e pelo servidor
 * (/api/cadastros/[entidade]). Cada cadastro declara:
 *  - modelo Prisma, rótulos, módulo e a permissão de cada ação;
 *  - campos do formulário e colunas da lista;
 *  - o schema de validação, que RECUSA campo desconhecido (empresaId, id, criadoEm… nunca entram
 *    pelo corpo: a empresa vem sempre da sessão).
 * Ativar/inativar NÃO passa pelo schema: é uma ação própria (regras.ts › definirAtivoCadastro).
 */

export const ENTIDADES_CADASTRO = ["produtos", "servicos", "cargos", "categorias-financeiras"] as const;
export type EntidadeCadastro = (typeof ENTIDADES_CADASTRO)[number];
export type ModeloCadastro = "produto" | "servico" | "cargo" | "categoriaFinanceira";
export type AcaoCadastro = "listar" | "criar" | "editar" | "inativar" | "reativar";

/** Basta UMA das permissões. `null` = qualquer usuário logado (catálogo lido nos seletores de outras telas). */
export type Requisito = [modulo: string, acao: Acao][] | null;

export interface CampoCadastro {
  key: string;
  label: string;
  tipo?: "texto" | "textarea" | "moeda" | "numero" | "inteiro" | "cor" | "select";
  opcoes?: { value: string; label: string }[];
  obrigatorio?: boolean;
  placeholder?: string;
  /** Agrupa no formulário (ex.: "Dados fiscais") */
  grupo?: string;
}

export interface ColunaCadastro {
  key: string;
  label: string;
  formato?: "texto" | "moeda" | "cor-nome";
}

export interface DefCadastro {
  entidade: EntidadeCadastro;
  modelo: ModeloCadastro;
  singular: string;
  plural: string;
  feminino?: boolean;
  /** Módulo da tela (ver lista / exportar) */
  modulo: string;
  permissoes: Record<AcaoCadastro, Requisito>;
  campos: CampoCadastro[];
  colunas: ColunaCadastro[];
  /** Campos usados na busca (?q=) */
  busca: string[];
  /** O que os outros registros gravam ao escolher este cadastro (categoria: o NOME) */
  chave: "id" | "nome";
  schemaCriar: z.ZodTypeAny;
  schemaEditar: z.ZodTypeAny;
}

/* ───────── Peças de validação ───────── */
const vazio = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

/** Texto opcional: "" vira null (limpa o campo). */
const textoOpcional = (max = 2000) => z.preprocess((v) => (vazio(v) ? null : v), z.string().trim().max(max).nullable());
const nome = z.string().trim().min(1, "Nome é obrigatório.").max(200);

/** Número opcional: "" vira null (não informado), aceita "12,5"; nunca erro 500. */
const numero = (o: { inteiro?: boolean; min?: number } = {}) => z.preprocess((v) => {
  if (vazio(v)) return null;
  if (typeof v === "string") { const n = Number(v.trim().replace(",", ".")); return Number.isFinite(n) ? n : v; }
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}, (o.inteiro ? z.number({ invalid_type_error: "Informe um número." }).int("Use um número inteiro.") : z.number({ invalid_type_error: "Informe um número." }))
  .min(o.min ?? 0, "Não pode ser negativo.").nullable());

/** Unidade: vazia ("Selecione") vira "un" na criação. */
const unidade = z.preprocess((v) => (vazio(v) ? "un" : v), z.string().trim().min(1).max(20));
const cor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use #RRGGBB).");

/**
 * Monta os dois schemas a partir dos campos:
 * - criar: obrigatórios exigidos, opcionais com padrão;
 * - editar: TODOS opcionais e SEM padrão (só muda o que veio — reativar nunca zera nada).
 * Os dois são `.strict()`: campo desconhecido (ex.: empresaId) = 400.
 */
function schemas<T extends z.ZodRawShape>(shape: T, padroes: Partial<Record<keyof T, unknown>> = {}) {
  const criar = z.object(Object.fromEntries(Object.entries(shape).map(([k, s]) =>
    [k, k in padroes ? (s as z.ZodTypeAny).optional().transform((v) => (v === undefined ? padroes[k as keyof T] : v)) : s],
  )) as z.ZodRawShape).strict();
  const editar = z.object(shape).partial().strict();
  return { schemaCriar: criar, schemaEditar: editar };
}

const SO_GESTOR: Requisito = [["configuracoes", "gerenciar"]];
const PERMISSOES_CONFIG: Record<AcaoCadastro, Requisito> = {
  listar: null, criar: SO_GESTOR, editar: SO_GESTOR, inativar: SO_GESTOR, reativar: SO_GESTOR,
};

const UNIDADES_PRODUTO = [
  { value: "un", label: "Unidade (un)" }, { value: "kg", label: "Quilograma (kg)" },
  { value: "m", label: "Metro linear (m)" }, { value: "m2", label: "Metro quadrado (m²)" },
];
const UNIDADES_SERVICO = [
  { value: "un", label: "Unidade (un)" }, { value: "hora", label: "Hora (h)" },
  { value: "m2", label: "Metro quadrado (m²)" }, { value: "m", label: "Metro linear (m)" },
];

/* ───────── Registro ───────── */
export const CADASTROS: Record<EntidadeCadastro, DefCadastro> = {
  produtos: {
    entidade: "produtos", modelo: "produto", singular: "produto", plural: "produtos",
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id",
    busca: ["nome", "descricao"],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Gás R410A" },
      { key: "descricao", label: "Descrição", tipo: "textarea" },
      { key: "unidade", label: "Unidade", tipo: "select", opcoes: UNIDADES_PRODUTO },
      { key: "valorPadrao", label: "Valor padrão (R$)", tipo: "moeda", placeholder: "0,00" },
      { key: "estoqueMinimo", label: "Estoque mínimo", tipo: "inteiro", placeholder: "0" },
    ],
    colunas: [
      { key: "nome", label: "Nome" }, { key: "unidade", label: "Unidade" },
      { key: "valorPadrao", label: "Valor padrão", formato: "moeda" }, { key: "estoqueMinimo", label: "Est. mín." },
    ],
    ...schemas({
      nome, descricao: textoOpcional(), unidade,
      valorPadrao: numero(), estoqueMinimo: numero({ inteiro: true }),
    }, { descricao: null, unidade: "un", valorPadrao: null, estoqueMinimo: null }),
  },
  servicos: {
    entidade: "servicos", modelo: "servico", singular: "serviço", plural: "serviços",
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id",
    busca: ["nome", "descricao", "codigoLc116", "codigoMunicipal"],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Manutenção Preventiva" },
      { key: "descricao", label: "Descrição", tipo: "textarea" },
      { key: "unidade", label: "Unidade", tipo: "select", opcoes: UNIDADES_SERVICO },
      { key: "valorPadrao", label: "Valor padrão (R$)", tipo: "moeda", placeholder: "0,00" },
      { key: "codigoMunicipal", label: "Código do serviço municipal", placeholder: "Ex: 1401", grupo: "Dados fiscais" },
      { key: "codigoLc116", label: "Código LC 116", placeholder: "Ex: 14.01", grupo: "Dados fiscais" },
      { key: "aliquotaISS", label: "Alíquota ISS (%)", tipo: "numero", placeholder: "Ex: 5,00", grupo: "Dados fiscais" },
      { key: "aliquotaPIS", label: "Alíquota PIS (%)", tipo: "numero", placeholder: "Ex: 0,65", grupo: "Dados fiscais" },
      { key: "aliquotaCOFINS", label: "Alíquota COFINS (%)", tipo: "numero", placeholder: "Ex: 3,00", grupo: "Dados fiscais" },
      { key: "aliquotaCSLL", label: "Alíquota CSLL (%)", tipo: "numero", placeholder: "Ex: 1,00", grupo: "Dados fiscais" },
      { key: "aliquotaIR", label: "Alíquota IR (%)", tipo: "numero", placeholder: "Ex: 1,50", grupo: "Dados fiscais" },
      { key: "observacaoFiscal", label: "Observação fiscal", tipo: "textarea", grupo: "Dados fiscais" },
    ],
    colunas: [
      { key: "nome", label: "Nome" }, { key: "unidade", label: "Unidade" },
      { key: "codigoLc116", label: "LC 116" }, { key: "valorPadrao", label: "Valor padrão", formato: "moeda" },
    ],
    ...schemas({
      nome, descricao: textoOpcional(), unidade, valorPadrao: numero(),
      codigoMunicipal: textoOpcional(50), codigoLc116: textoOpcional(50),
      aliquotaISS: numero(), aliquotaPIS: numero(), aliquotaCOFINS: numero(), aliquotaCSLL: numero(), aliquotaIR: numero(),
      observacaoFiscal: textoOpcional(),
    }, {
      descricao: null, unidade: "un", valorPadrao: null, codigoMunicipal: null, codigoLc116: null,
      aliquotaISS: null, aliquotaPIS: null, aliquotaCOFINS: null, aliquotaCSLL: null, aliquotaIR: null, observacaoFiscal: null,
    }),
  },
  cargos: {
    entidade: "cargos", modelo: "cargo", singular: "cargo", plural: "cargos",
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id",
    busca: ["nome", "descricao"],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Técnico de Refrigeração" },
      { key: "descricao", label: "Descrição", tipo: "textarea", placeholder: "Atribuições do cargo" },
    ],
    colunas: [{ key: "nome", label: "Nome" }, { key: "descricao", label: "Descrição" }],
    ...schemas({ nome, descricao: textoOpcional() }, { descricao: null }),
  },
  "categorias-financeiras": {
    entidade: "categorias-financeiras", modelo: "categoriaFinanceira", singular: "categoria", plural: "categorias", feminino: true,
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG,
    // A conta a receber grava o NOME da categoria (texto), não o id
    chave: "nome",
    busca: ["nome"],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Contrato Mensal" },
      { key: "cor", label: "Cor", tipo: "cor" },
    ],
    colunas: [{ key: "nome", label: "Nome", formato: "cor-nome" }],
    ...schemas({ nome, cor }, { cor: "#64748B" }),
  },
};

export function ehEntidadeCadastro(v: string): v is EntidadeCadastro {
  return (ENTIDADES_CADASTRO as readonly string[]).includes(v);
}

/** Filtro de status da lista: sim = ativos (padrão), nao = inativos, todos. */
export type FiltroAtivo = "sim" | "nao" | "todos";
export function lerFiltroAtivo(v: string | null | undefined, padrao: FiltroAtivo = "sim"): FiltroAtivo {
  return v === "sim" || v === "nao" || v === "todos" ? v : padrao;
}

/** where da lista (empresa + status + busca) — o mesmo da tela, do "selecionar todos do filtro" e da exportação. */
export function whereCadastro(def: DefCadastro, empresaId: string, f: { ativo: FiltroAtivo; q?: string | null }) {
  const q = f.q?.trim();
  return {
    empresaId,
    ...(f.ativo === "sim" ? { ativo: true } : f.ativo === "nao" ? { ativo: false } : {}),
    ...(q ? { OR: def.busca.map((k) => ({ [k]: { contains: q, mode: "insensitive" as const } })) } : {}),
  };
}

/** Mensagem legível do erro de validação (campo desconhecido incluso). */
export function mensagemValidacao(e: z.ZodError, def: DefCadastro): string {
  const i = e.issues[0];
  if (!i) return "Dados inválidos.";
  if (i.code === "unrecognized_keys") return `Campo não permitido: ${i.keys.join(", ")}.`;
  const campo = def.campos.find((c) => c.key === i.path[0])?.label;
  return campo ? `${campo}: ${i.message}` : i.message;
}
