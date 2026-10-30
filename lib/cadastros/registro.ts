import { z } from "zod";
import type { Acao } from "@/lib/permissoes";
import { REGIMES, REGIME_LABEL } from "@/lib/folha/calculo";
import { itensEncargoSchema } from "@/lib/folha/validacao";
import type { Direcao, MapaOrdem } from "@/lib/listagem";
import { descricaoLc116, LISTA_LC116 } from "@/lib/nfse/lc116";
import type { OpcaoCodigo } from "@/lib/nfse/busca-codigo";
import { erroAliquota, formatarCnae, normalizarCnae, normalizarLc116, TRIBUTACOES_ISS } from "@/lib/nfse/servico";

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

export const ENTIDADES_CADASTRO = [
  "produtos", "servicos", "cargos", "categorias-financeiras",
  // Leva 4: acesso ao sistema e custo de pessoal
  "perfis-acesso", "modelos-encargos", "usuarios",
  // Leva 3: cadastros operacionais que ficaram para trás
  "tipos-equipamento", "tabelas-preco", "termos-referencia", "modelos-prazo",
  // Leva 5.2: fornecedor de verdade (ligado na conta a pagar)
  "fornecedores",
  // E2.1: centro de custo (toda conta a pagar; aprendido por fornecedor na nota de compra)
  "centros-custo",
  // CR robusto: onde o dinheiro entra (a conta a receber escolhe a conta bancária por ID)
  "contas-bancarias",
] as const;
export type EntidadeCadastro = (typeof ENTIDADES_CADASTRO)[number];
export type ModeloCadastro = "produto" | "servico" | "cargo" | "categoriaFinanceira" | "perfilAcesso" | "modeloEncargos" | "usuario"
  | "tipoEquipamentoCustom" | "tabelaPreco" | "termoReferenciaTemplate" | "prazoTemplate" | "fornecedor" | "centroCusto" | "contaBancaria";
export type AcaoCadastro = "listar" | "criar" | "editar" | "inativar" | "reativar";

/** Basta UMA das permissões. `null` = qualquer usuário logado (catálogo lido nos seletores de outras telas). */
export type Requisito = [modulo: string, acao: Acao][] | null;

export interface CampoCadastro {
  key: string;
  label: string;
  tipo?: "texto" | "textarea" | "moeda" | "numero" | "inteiro" | "cor" | "select" | "email";
  opcoes?: { value: string; label: string }[];
  obrigatorio?: boolean;
  placeholder?: string;
  /** Agrupa no formulário (ex.: "Dados fiscais") */
  grupo?: string;
  /** Texto de ajuda discreto embaixo do campo */
  ajuda?: string;
  /** Como mostrar o valor gravado no formulário (ex.: CNAE 4321500 → 4321-5/00); o servidor normaliza de volta */
  formatar?: (v: string) => string;
  /** Ajuda que depende do que foi digitado (ex.: a descrição do código LC 116); null = a `ajuda` fixa */
  descrever?: (v: string) => string | null;
  /** Lista de códigos para a busca-e-seleção (filtra por código ou descrição); o digitado também vale */
  opcoesCodigo?: readonly OpcaoCodigo[];
  /**
   * Permissão a mais para ALTERAR este campo (além de editar o cadastro). Sem ela, a tela mostra o
   * campo só para leitura e o servidor recusa a mudança (lib/cadastros/especificos.ts).
   */
  permissao?: [modulo: string, acao: Acao];
}

export interface ColunaCadastro {
  key: string;
  label: string;
  /** "codigo": código do item (fonte mono; no celular vai junto do nome no título do cartão) */
  formato?: "texto" | "moeda" | "cor-nome" | "codigo";
  /**
   * Ordenar clicando no cabeçalho: nome do campo (escalar) ou o orderBy do Prisma para a direção
   * (relação/contagem). Sem isto a coluna não é ordenável — o servidor só aceita a lista branca.
   */
  ordenar?: string | ((dir: "asc" | "desc") => unknown);
}

/** Requisito de cada ação: "logado" não existe aqui — use null em listar. */

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
  /** Campos numéricos que a busca acha quando se digita só o número (ex.: código do produto) */
  buscaNumero?: string[];
  /** Campo mostrado ao lado do nome nas sugestões da busca (ex.: CNPJ do fornecedor) */
  detalheSugestao?: string;
  /** O que os outros registros gravam ao escolher este cadastro (categoria: o NOME) */
  chave: "id" | "nome";
  /** Tela do cadastro completo (link "Abrir cadastro completo" no cadastro rápido) */
  rota?: string;
  schemaCriar: z.ZodTypeAny;
  schemaEditar: z.ZodTypeAny;
  /** Colunas que NUNCA saem em resposta nenhuma (ex.: senha do usuário) */
  ocultos?: string[];
  /** include do Prisma na lista/registro (dados puros, sem funções) */
  incluir?: Record<string, unknown>;
  /** include a mais só no registro único (GET /[id], edição, impacto) — ex.: itens da tabela de preço */
  incluirItem?: Record<string, unknown>;
  /** orderBy da lista (padrão: nome) */
  ordem?: unknown;
  /** O formulário é um editor próprio (passado pela página ao CadastroPadrao), não os `campos` */
  editorProprio?: boolean;
  /** Entra nas ações em massa (lib/acoes-massa/acoes.ts) */
  massa?: boolean;
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
function schemas<T extends z.ZodRawShape>(shape: T, padroes: Partial<Record<keyof T, unknown>> = {}, opts: { soCriar?: (keyof T)[] } = {}) {
  const criar = z.object(Object.fromEntries(Object.entries(shape).map(([k, s]) =>
    [k, k in padroes ? (s as z.ZodTypeAny).optional().transform((v) => (v === undefined ? padroes[k as keyof T] : v)) : s],
  )) as z.ZodRawShape).strict();
  // `soCriar`: definidos só na criação (ex.: e-mail de login) — na edição viram "campo não permitido"
  const editavel = Object.fromEntries(Object.entries(shape).filter(([k]) => !opts.soCriar?.includes(k as keyof T))) as z.ZodRawShape;
  const editar = z.object(editavel).partial().strict();
  return { schemaCriar: criar, schemaEditar: editar };
}

/* ───────── Dados fiscais do serviço (NFS-e) ───────── */
/** Texto passado por uma normalização que devolve { valor | erro } (a normalização já trata o vazio = null) */
const normalizado = (fn: (v: unknown) => { valor: string | null; erro?: string }) =>
  z.union([z.null(), z.string()]).transform((v, ctx) => {
    if (v === null) return null;
    const r = fn(v);
    if (r.erro) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.erro }); return z.NEVER; }
    return r.valor;
  });
const lc116 = normalizado((v) => { const r = normalizarLc116(v); return { valor: r.codigo, erro: r.erro }; });
const cnae = normalizado((v) => { const r = normalizarCnae(v); return { valor: r.cnae, erro: r.erro }; });
const aliquotaIss = numero().refine((v) => !erroAliquota(v), "Alíquota de ISS deve estar entre 0 e 100%.");
/** "true"/"false" do formulário (ou booleano); vazio/ausente = false */
const booleano = z.preprocess((v) => (v === "true" ? true : v === "false" || vazio(v) ? false : v), z.boolean());
const nfseTributacao = z.preprocess((v) => (vazio(v) ? null : v),
  z.enum(TRIBUTACOES_ISS.map((t) => t.id) as [string, ...string[]], { errorMap: () => ({ message: "Tributação do ISS inválida." }) }).nullable());

export const GRUPO_NFSE = "Dados fiscais (NFS-e)";
const FISCAL: [string, Acao] = ["financeiro", "fiscal"];
/** Campos da NFS-e no cadastro do serviço: alterar exige Financeiro › Fiscal (tela e servidor) */
export const CAMPOS_NFSE_SERVICO: CampoCadastro[] = [
  // Classificação do serviço
  { key: "codigoLc116", label: "Código do serviço (LC 116)", placeholder: "Busque pelo código ou pela descrição", grupo: GRUPO_NFSE, permissao: FISCAL,
    opcoesCodigo: LISTA_LC116,
    ajuda: "Subitem da lista de serviços da Lei Complementar 116/2003, no formato NN.NN.",
    descrever: (v) => { const n = normalizarLc116(v).codigo; const d = descricaoLc116(n); return d ? `${n} — ${d}` : null; } },
  { key: "codigoMunicipal", label: "Código municipal", placeholder: "Em branco: código LC 116", grupo: GRUPO_NFSE, permissao: FISCAL,
    ajuda: "Preencha apenas se a prefeitura adotar codificação própria de serviços. Em branco, a nota usa o código LC 116." },
  { key: "cnae", label: "CNAE", placeholder: "Ex: 4322-3/02", grupo: GRUPO_NFSE, permissao: FISCAL, formatar: formatarCnae,
    ajuda: "Em branco, a nota usa o CNAE principal da empresa." },
  // Tributação
  { key: "nfseTributacao", label: "Tributação do ISS", tipo: "select", grupo: GRUPO_NFSE, permissao: FISCAL,
    opcoes: [{ value: "", label: `${TRIBUTACOES_ISS[0].label} (padrão)` }, ...TRIBUTACOES_ISS.slice(1).map((t) => ({ value: t.id, label: t.label }))] },
  { key: "aliquotaISS", label: "Alíquota de ISS (%)", tipo: "numero", placeholder: "Ex: 5,00", grupo: GRUPO_NFSE, permissao: FISCAL,
    ajuda: "Em branco, a nota usa a alíquota de ISS da empresa." },
  { key: "issRetido", label: "ISS retido pelo tomador", tipo: "select", grupo: GRUPO_NFSE, permissao: FISCAL,
    opcoes: [{ value: "false", label: "Não" }, { value: "true", label: "Sim — o tomador retém e recolhe o ISS" }] },
  // Discriminação
  { key: "discriminacaoPadrao", label: "Discriminação padrão", tipo: "textarea", grupo: GRUPO_NFSE, permissao: FISCAL,
    placeholder: "Ex: Manutenção preventiva de equipamentos de ar-condicionado conforme contrato.",
    ajuda: "Texto-base da discriminação da NFS-e. Pode ser ajustado no momento da emissão." },
];

const SO_GESTOR: Requisito = [["configuracoes", "gerenciar"]];
const SO_FOLHA: Requisito = [["financeiro", "folha"]];
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

/* Itens de tabela de preço e etapas de modelo de prazo (enums literais: o registro é puro, sem Prisma) */
const idOpcional = z.preprocess((v) => (vazio(v) ? null : v), z.string().max(40).nullable());
export const itemTabelaSchema = z.object({
  servicoId: idOpcional.optional(),
  produtoId: idOpcional.optional(),
  tipoPreco: z.enum(["VALOR_FIXO", "DESCONTO_PERCENTUAL"]).default("VALOR_FIXO"),
  valorFixo: numero().optional(),
  descontoPercent: numero().refine((v) => v == null || v <= 100, "Desconto vai até 100%.").optional(),
  bloqueado: z.boolean().default(false),
}).strict().refine((it) => !!it.servicoId !== !!it.produtoId, { message: "Cada item da tabela é um serviço OU um produto." });
export const etapaPrazoSchema = z.object({
  nome: z.string().trim().min(1, "Toda etapa precisa de um nome.").max(120),
  prazoHoras: z.preprocess((v) => (vazio(v) ? 24 : typeof v === "string" ? Number(v.replace(",", ".")) : v),
    z.number({ invalid_type_error: "Prazo da etapa inválido." }).positive("O prazo da etapa precisa ser maior que zero.").max(24 * 365)),
  responsavel: z.enum(["COMPRADOR", "GESTOR", "TECNICO", "CLIENTE"]).default("COMPRADOR"),
  canal: z.enum(["WHATSAPP", "EMAIL", "SISTEMA"]).default("WHATSAPP"),
  mensagem: textoOpcional(2000).optional(),
  // A ordem é a posição na lista (o cliente pode mandar, mas é ignorada)
  ordem: z.number().optional(),
}).strict();

/** CNPJ/CPF: guarda só os dígitos; vazio = sem documento; precisa ter 11 (CPF) ou 14 (CNPJ) dígitos. */
export const documentoSchema = z.preprocess((v) => {
  if (vazio(v)) return null;
  return typeof v === "string" ? v.replace(/\D/g, "") : v;
}, z.string().refine((d) => d.length === 11 || d.length === 14, "CNPJ/CPF inválido: use 14 dígitos (CNPJ) ou 11 (CPF).").nullable());
const emailOpcional = z.preprocess((v) => (vazio(v) ? null : typeof v === "string" ? v.trim().toLowerCase() : v),
  z.string().email("E-mail inválido.").max(160).nullable());

/* ───────── Registro ───────── */
export const CADASTROS: Record<EntidadeCadastro, DefCadastro> = {
  produtos: {
    entidade: "produtos", modelo: "produto", massa: true, singular: "produto", plural: "produtos",
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id", rota: "/configuracoes/produtos",
    // Código: número gerado pelo sistema ao criar (não é campo do formulário); a busca acha por ele
    busca: ["nome", "descricao"], buscaNumero: ["codigo"], detalheSugestao: "codigo",
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Gás R410A" },
      { key: "descricao", label: "Descrição", tipo: "textarea" },
      { key: "unidade", label: "Unidade", tipo: "select", opcoes: UNIDADES_PRODUTO },
      { key: "valorPadrao", label: "Valor padrão (R$)", tipo: "moeda", placeholder: "0,00" },
      { key: "estoqueMinimo", label: "Estoque mínimo", tipo: "inteiro", placeholder: "0" },
    ],
    colunas: [
      { key: "codigo", label: "Cód.", formato: "codigo", ordenar: "codigo" },
      { key: "nome", label: "Nome", ordenar: "nome" }, { key: "unidade", label: "Unidade", ordenar: "unidade" },
      { key: "valorPadrao", label: "Valor padrão", formato: "moeda", ordenar: "valorPadrao" }, { key: "estoqueMinimo", label: "Est. mín.", ordenar: "estoqueMinimo" },
    ],
    ...schemas({
      nome, descricao: textoOpcional(), unidade,
      valorPadrao: numero(), estoqueMinimo: numero({ inteiro: true }),
    }, { descricao: null, unidade: "un", valorPadrao: null, estoqueMinimo: null }),
  },
  servicos: {
    entidade: "servicos", modelo: "servico", massa: true, singular: "serviço", plural: "serviços",
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id", rota: "/configuracoes/servicos",
    busca: ["codigo", "nome", "descricao", "codigoLc116", "codigoMunicipal"], detalheSugestao: "codigo",
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Manutenção Preventiva" },
      { key: "codigo", label: "Código", placeholder: "Vazio = gerado pelo nome (ex.: MANU01)" },
      { key: "descricao", label: "Descrição", tipo: "textarea" },
      { key: "unidade", label: "Unidade", tipo: "select", opcoes: UNIDADES_SERVICO },
      { key: "valorPadrao", label: "Valor padrão (R$)", tipo: "moeda", placeholder: "0,00" },
      ...CAMPOS_NFSE_SERVICO,
      { key: "aliquotaPIS", label: "Alíquota PIS (%)", tipo: "numero", placeholder: "Ex: 0,65", grupo: "Outros tributos" },
      { key: "aliquotaCOFINS", label: "Alíquota COFINS (%)", tipo: "numero", placeholder: "Ex: 3,00", grupo: "Outros tributos" },
      { key: "aliquotaCSLL", label: "Alíquota CSLL (%)", tipo: "numero", placeholder: "Ex: 1,00", grupo: "Outros tributos" },
      { key: "aliquotaIR", label: "Alíquota IR (%)", tipo: "numero", placeholder: "Ex: 1,50", grupo: "Outros tributos" },
      { key: "observacaoFiscal", label: "Observação fiscal", tipo: "textarea", grupo: "Outros tributos" },
    ],
    colunas: [
      { key: "codigo", label: "Código", formato: "codigo", ordenar: "codigo" },
      { key: "nome", label: "Nome", ordenar: "nome" }, { key: "unidade", label: "Unidade", ordenar: "unidade" },
      { key: "codigoLc116", label: "LC 116", ordenar: "codigoLc116" }, { key: "valorPadrao", label: "Valor padrão", formato: "moeda", ordenar: "valorPadrao" },
    ],
    ...schemas({
      // Código: normalizado e conferido (único na empresa) pela regra do cadastro (especificos.ts)
      nome, codigo: textoOpcional(40), descricao: textoOpcional(), unidade, valorPadrao: numero(),
      codigoMunicipal: textoOpcional(50), codigoLc116: lc116,
      aliquotaISS: aliquotaIss, aliquotaPIS: numero(), aliquotaCOFINS: numero(), aliquotaCSLL: numero(), aliquotaIR: numero(),
      observacaoFiscal: textoOpcional(),
      nfseTributacao, issRetido: booleano, cnae, discriminacaoPadrao: textoOpcional(),
    }, {
      codigo: null, descricao: null, unidade: "un", valorPadrao: null, codigoMunicipal: null, codigoLc116: null,
      aliquotaISS: null, aliquotaPIS: null, aliquotaCOFINS: null, aliquotaCSLL: null, aliquotaIR: null, observacaoFiscal: null,
      nfseTributacao: null, cnae: null, discriminacaoPadrao: null,
    }),
  },
  cargos: {
    entidade: "cargos", modelo: "cargo", massa: true, singular: "cargo", plural: "cargos",
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id", rota: "/configuracoes/cargos",
    busca: ["nome", "descricao"],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Técnico de Refrigeração" },
      { key: "descricao", label: "Descrição", tipo: "textarea", placeholder: "Atribuições do cargo" },
    ],
    colunas: [{ key: "nome", label: "Nome", ordenar: "nome" }, { key: "descricao", label: "Descrição", ordenar: "descricao" }],
    ...schemas({ nome, descricao: textoOpcional() }, { descricao: null }),
  },
  "categorias-financeiras": {
    entidade: "categorias-financeiras", modelo: "categoriaFinanceira", massa: true, singular: "categoria", plural: "categorias", feminino: true,
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG,
    // As contas (a receber e a pagar) gravam o ID da categoria (Leva 5.1): renomear não desliga nada
    chave: "id", rota: "/configuracoes/financeiro/categorias",
    busca: ["nome"],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Contrato Mensal" },
      { key: "cor", label: "Cor", tipo: "cor" },
    ],
    colunas: [{ key: "nome", label: "Nome", formato: "cor-nome", ordenar: "nome" }],
    ...schemas({ nome, cor }, { cor: "#64748B" }),
  },
  "perfis-acesso": {
    entidade: "perfis-acesso", modelo: "perfilAcesso", singular: "perfil de acesso", plural: "perfis de acesso", massa: true,
    modulo: "configuracoes",
    // Listar: quem vê Configurações e quem cadastra colaborador (o formulário escolhe o perfil)
    permissoes: { listar: [["configuracoes", "visualizar"], ["equipes", "gerenciar"]], criar: SO_GESTOR, editar: SO_GESTOR, inativar: SO_GESTOR, reativar: SO_GESTOR },
    chave: "id", editorProprio: true,
    busca: ["nome", "descricao"],
    incluir: { _count: { select: { usuarios: true, colaboradores: true } } },
    ordem: [{ padraoSistema: "desc" }, { nome: "asc" }],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true },
      { key: "descricao", label: "Descrição", tipo: "textarea" },
      { key: "tipo", label: "Tipo" },
      { key: "cor", label: "Cor", tipo: "cor" },
    ],
    colunas: [{ key: "nome", label: "Perfil", formato: "cor-nome", ordenar: "nome" }, { key: "tipo", label: "Tipo", ordenar: "tipo" }, { key: "uso", label: "Em uso", ordenar: (dir) => ({ usuarios: { _count: dir } }) }],
    ...schemas({
      nome: nome.max(80), descricao: textoOpcional(500),
      tipo: z.enum(["ADMINISTRADOR", "SUPERVISOR", "FINANCEIRO", "TECNICO", "AUXILIAR", "PERSONALIZADO"]),
      cor,
      permissoes: z.record(z.string(), z.record(z.string(), z.boolean())),
    }, { descricao: null, tipo: "PERSONALIZADO", cor: "#8B5CF6", permissoes: {} }),
  },
  "modelos-encargos": {
    entidade: "modelos-encargos", modelo: "modeloEncargos", singular: "modelo de encargos", plural: "modelos de encargos", massa: true,
    modulo: "financeiro",
    permissoes: { listar: SO_FOLHA, criar: SO_FOLHA, editar: SO_FOLHA, inativar: SO_FOLHA, reativar: SO_FOLHA },
    chave: "id", editorProprio: true,
    busca: ["nome"],
    incluir: { _count: { select: { colaboradores: true } } },
    ordem: [{ regime: "asc" }, { padrao: "desc" }, { nome: "asc" }],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true },
      { key: "regime", label: "Tipo de contrato", tipo: "select", opcoes: REGIMES.map((r) => ({ value: r, label: REGIME_LABEL[r] })) },
      { key: "padrao", label: "Padrão do tipo" },
    ],
    colunas: [{ key: "nome", label: "Modelo", ordenar: "nome" }, { key: "regime", label: "Tipo de contrato", ordenar: "regime" }, { key: "total", label: "Encargos" }, { key: "uso", label: "Em uso", ordenar: (dir) => ({ colaboradores: { _count: dir } }) }],
    ...schemas({
      nome: nome.max(80), regime: z.enum(REGIMES), padrao: z.boolean(), itens: itensEncargoSchema,
    }, { padrao: false, itens: [] }),
  },
  usuarios: {
    entidade: "usuarios", modelo: "usuario", singular: "usuário", plural: "usuários",
    modulo: "configuracoes",
    // Dados de contato e de acesso: só quem gerencia as Configurações (igual à tela antiga)
    permissoes: { listar: SO_GESTOR, criar: SO_GESTOR, editar: SO_GESTOR, inativar: SO_GESTOR, reativar: SO_GESTOR },
    chave: "id", editorProprio: true,
    busca: ["nome", "email"], detalheSugestao: "email",
    // O hash da senha nunca sai em resposta nenhuma
    ocultos: ["senha"],
    incluir: { perfilAcesso: { select: { id: true, nome: true, cor: true, ativo: true } } },
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true },
      { key: "email", label: "E-mail", tipo: "email", obrigatorio: true },
    ],
    colunas: [{ key: "nome", label: "Usuário", ordenar: "nome" }, { key: "perfil", label: "Perfil de acesso", ordenar: (dir) => ({ perfilAcesso: { nome: dir } }) }, { key: "ultimoAcesso", label: "Último acesso", ordenar: (dir) => ({ ultimoAcesso: { sort: dir, nulls: "last" } }) }],
    ...schemas({
      nome: z.string().trim().min(2, "Informe o nome (mín. 2 letras).").max(120),
      email: z.string().trim().toLowerCase().email("E-mail inválido.").max(160),
      perfilAcessoId: z.preprocess((v) => (vazio(v) ? null : v), z.string().max(40).nullable()),
    }, { perfilAcessoId: null }, { soCriar: ["email"] }),
  },
  "tipos-equipamento": {
    entidade: "tipos-equipamento", modelo: "tipoEquipamentoCustom", massa: true, singular: "tipo de equipamento", plural: "tipos de equipamento",
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id", editorProprio: true,
    busca: ["nome", "descricao"],
    incluir: { _count: { select: { equipamentos: true, formTypeMappings: true, checklistItens: { where: { ativo: true } } } } },
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Split, Chiller, VRF" },
      { key: "descricao", label: "Observações", tipo: "textarea" },
    ],
    colunas: [{ key: "nome", label: "Tipo", ordenar: "nome" }, { key: "descricao", label: "Observações", ordenar: "descricao" }, { key: "uso", label: "Em uso", ordenar: (dir) => ({ equipamentos: { _count: dir } }) }],
    // chaveEnum (âncora dos tipos padrão) nunca entra pelo corpo
    ...schemas({ nome: nome.max(120), descricao: textoOpcional(1000) }, { descricao: null }),
  },
  "tabelas-preco": {
    entidade: "tabelas-preco", modelo: "tabelaPreco", massa: true, singular: "tabela de preços", plural: "tabelas de preços", feminino: true,
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id", editorProprio: true,
    busca: ["nome", "descricao"],
    incluir: { _count: { select: { itens: true, clientes: true } } },
    // Os itens só no registro único (o editor busca ao abrir): a lista e os seletores ficam leves
    incluirItem: {
      itens: { include: { servico: { select: { id: true, nome: true, valorPadrao: true, ativo: true } }, produto: { select: { id: true, nome: true, valorPadrao: true, ativo: true } } } },
    },
    ordem: [{ tipo: "asc" }, { nome: "asc" }],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true },
      { key: "tipo", label: "Tipo", tipo: "select", opcoes: [{ value: "PADRAO", label: "Padrão" }, { value: "CONTRATO", label: "Contrato" }, { value: "PERSONALIZADA", label: "Personalizada" }] },
      { key: "descricao", label: "Descrição", tipo: "textarea" },
    ],
    colunas: [{ key: "nome", label: "Tabela", ordenar: "nome" }, { key: "tipo", label: "Tipo", ordenar: "tipo" }, { key: "itens", label: "Itens", ordenar: (dir) => ({ itens: { _count: dir } }) }, { key: "uso", label: "Clientes", ordenar: (dir) => ({ clientes: { _count: dir } }) }],
    ...schemas({
      nome: z.string().trim().min(2, "Informe o nome da tabela.").max(120), descricao: textoOpcional(1000),
      tipo: z.enum(["PADRAO", "CONTRATO", "PERSONALIZADA"]), precosBloqueados: z.boolean(),
      itens: z.array(itemTabelaSchema).max(2000),
    }, { descricao: null, tipo: "PERSONALIZADA", precosBloqueados: false, itens: [] }),
  },
  "termos-referencia": {
    entidade: "termos-referencia", modelo: "termoReferenciaTemplate", massa: true, singular: "termo de referência", plural: "termos de referência",
    modulo: "configuracoes",
    // Ler: quem vê Configurações (a proposta recebe os termos já carregados pela página)
    permissoes: { ...PERMISSOES_CONFIG, listar: [["configuracoes", "visualizar"]] },
    chave: "id", editorProprio: true,
    busca: ["nome", "descricao"],
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true },
      { key: "descricao", label: "Descrição" },
      { key: "conteudo", label: "Conteúdo", tipo: "textarea" },
    ],
    colunas: [{ key: "nome", label: "Termo", ordenar: "nome" }, { key: "descricao", label: "Descrição", ordenar: "descricao" }],
    ...schemas({
      nome: nome.max(160), descricao: textoOpcional(500),
      conteudo: z.preprocess((v) => (v == null ? "" : v), z.string().max(100_000)),
    }, { descricao: null, conteudo: "" }),
  },
  "modelos-prazo": {
    entidade: "modelos-prazo", modelo: "prazoTemplate", massa: true, singular: "modelo de prazo", plural: "modelos de prazo",
    // Ler: qualquer usuário logado (a OS escolhe o modelo); gravar: Configurações › gerenciar
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id", editorProprio: true,
    busca: ["nome", "descricao"],
    incluir: { etapas: { orderBy: { ordem: "asc" } }, _count: { select: { osPrazos: true } } },
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true },
      { key: "descricao", label: "Descrição", tipo: "textarea" },
      { key: "cor", label: "Cor", tipo: "cor" },
    ],
    colunas: [{ key: "nome", label: "Modelo", formato: "cor-nome", ordenar: "nome" }, { key: "etapas", label: "Etapas", ordenar: (dir) => ({ etapas: { _count: dir } }) }, { key: "uso", label: "Usado em", ordenar: (dir) => ({ osPrazos: { _count: dir } }) }],
    ...schemas({
      nome: z.string().trim().min(2, "Informe o nome do modelo.").max(120), descricao: textoOpcional(1000), cor,
      etapas: z.array(etapaPrazoSchema).min(1, "Adicione ao menos uma etapa.").max(50),
    }, { descricao: null, cor: "#0EA5E9" }),
  },
  fornecedores: {
    entidade: "fornecedores", modelo: "fornecedor", massa: true, singular: "fornecedor", plural: "fornecedores",
    // Ver: quem usa o financeiro (a conta a pagar escolhe o fornecedor) ou Compras / quem edita o pedido de
    // compra na OS/orçamento (o PC vai ao fornecedor); gravar: quem lança contas a pagar ou gerencia as configurações
    modulo: "financeiro",
    permissoes: {
      listar: [["financeiro", "visualizar"], ["configuracoes", "visualizar"], ["compras", "visualizar"], ["ordens", "editar"], ["orcamentos", "editar"]],
      criar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
      editar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
      inativar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
      reativar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
    },
    chave: "id", rota: "/financeiro/fornecedores",
    busca: ["nome", "documento", "email", "telefone"], detalheSugestao: "documento",
    incluir: { _count: { select: { contasPagar: true } } },
    campos: [
      { key: "nome", label: "Nome / razão social", obrigatorio: true, placeholder: "Ex: Frigelar Distribuidora" },
      { key: "documento", label: "CNPJ / CPF", placeholder: "00.000.000/0000-00" },
      { key: "telefone", label: "Telefone", placeholder: "(00) 00000-0000" },
      { key: "email", label: "E-mail", tipo: "email", placeholder: "contato@fornecedor.com.br" },
      { key: "observacoes", label: "Observações", tipo: "textarea" },
    ],
    colunas: [{ key: "nome", label: "Fornecedor", ordenar: "nome" }, { key: "documento", label: "CNPJ / CPF", ordenar: "documento" }, { key: "contato", label: "Contato" }, { key: "uso", label: "Contas a pagar", ordenar: (dir) => ({ contasPagar: { _count: dir } }) }],
    ...schemas({
      nome: nome, documento: documentoSchema, telefone: textoOpcional(30), email: emailOpcional, observacoes: textoOpcional(2000),
    }, { documento: null, telefone: null, email: null, observacoes: null }),
  },
  "centros-custo": {
    entidade: "centros-custo", modelo: "centroCusto", massa: true, singular: "centro de custo", plural: "centros de custo",
    // Igual às categorias financeiras (a outra classificação da despesa): qualquer usuário logado lê
    // (seletor da conta a pagar e da nota de compra); gravar: Configurações › gerenciar
    modulo: "configuracoes", permissoes: PERMISSOES_CONFIG, chave: "id", rota: "/configuracoes/financeiro/centros-custo",
    busca: ["nome"],
    incluir: { _count: { select: { contasPagar: true } } },
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Obra Shopping Norte, Frota, Administrativo" },
    ],
    colunas: [{ key: "nome", label: "Centro de custo", ordenar: "nome" }, { key: "uso", label: "Contas a pagar", ordenar: (dir) => ({ contasPagar: { _count: dir } }) }],
    // Nome único na empresa (sem diferença de maiúsculas): regra em especificos.ts
    ...schemas({ nome: nome.max(120) }),
  },
  "contas-bancarias": {
    entidade: "contas-bancarias", modelo: "contaBancaria", singular: "conta bancária", plural: "contas bancárias",
    // Ler: quem usa o financeiro (a conta a receber escolhe onde o dinheiro entra); gravar: quem lança o
    // fluxo de caixa ou gerencia as configurações (igual ao fornecedor)
    modulo: "financeiro",
    permissoes: {
      listar: [["financeiro", "visualizar"], ["configuracoes", "visualizar"]],
      criar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
      editar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
      inativar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
      reativar: [["financeiro", "fluxoCaixa"], ["configuracoes", "gerenciar"]],
    },
    chave: "id", rota: "/financeiro/contas-bancarias",
    busca: ["nome", "banco", "agencia", "conta"], detalheSugestao: "banco",
    incluir: { _count: { select: { contasReceber: true } } },
    campos: [
      { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Inter PJ, Itaú movimento" },
      { key: "banco", label: "Banco", placeholder: "Ex: Banco Inter (077)" },
      { key: "agencia", label: "Agência", placeholder: "0001" },
      { key: "conta", label: "Conta", placeholder: "12345-6" },
    ],
    colunas: [{ key: "nome", label: "Conta bancária", ordenar: "nome" }, { key: "banco", label: "Banco", ordenar: "banco" }, { key: "agconta", label: "Agência / conta" }, { key: "uso", label: "Contas a receber", ordenar: (dir) => ({ contasReceber: { _count: dir } }) }],
    // Nome único na empresa (sem diferença de maiúsculas): regra em especificos.ts
    ...schemas({ nome: nome.max(120), banco: textoOpcional(120), agencia: textoOpcional(20), conta: textoOpcional(30) },
      { banco: null, agencia: null, conta: null }),
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
/** Lista branca de ordenação da tela (coluna → orderBy). */
export function mapaOrdemCadastro(def: DefCadastro): MapaOrdem {
  return Object.fromEntries(def.colunas.filter((c) => c.ordenar).map((c) => [c.key,
    typeof c.ordenar === "string" ? (dir: Direcao) => ({ [c.ordenar as string]: dir }) : (c.ordenar as (d: Direcao) => unknown)]));
}

export function whereCadastro(def: DefCadastro, empresaId: string, f: { ativo: FiltroAtivo; q?: string | null }) {
  const q = f.q?.trim();
  return {
    empresaId,
    ...(f.ativo === "sim" ? { ativo: true } : f.ativo === "nao" ? { ativo: false } : {}),
    ...(q ? { OR: [
      ...def.busca.map((k) => ({ [k]: { contains: q, mode: "insensitive" as const } })),
      // Só o número digitado: acha também pelo código numérico (produto 15)
      ...(/^\d{1,9}$/.test(q) ? (def.buscaNumero ?? []).map((k) => ({ [k]: Number(q) })) : []),
    ] } : {}),
  };
}

/** Mesmo valor para fins de permissão (Decimal do Prisma × número do formulário; null × ausente). */
export const mesmoValor = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));

/**
 * Campos com `permissao` própria que o ator está tentando MUDAR sem ter essa permissão.
 * Criar: conta qualquer valor preenchido (null/false/"" = o padrão). Editar: conta só o que difere do gravado.
 * Vazio = pode gravar.
 */
export function camposSemPermissao(
  def: DefCadastro, permitido: (modulo: string, acao: Acao) => boolean,
  dados: Record<string, unknown>, existente?: Record<string, unknown> | null,
): CampoCadastro[] {
  return def.campos
    .filter((c) => c.permissao && !permitido(...c.permissao) && dados[c.key] !== undefined)
    .filter((c) => (existente ? !mesmoValor(dados[c.key], existente[c.key]) : dados[c.key] != null && dados[c.key] !== false && dados[c.key] !== ""));
}

/** Mensagem legível do erro de validação (campo desconhecido incluso). */
export function mensagemValidacao(e: z.ZodError, def: DefCadastro): string {
  const i = e.issues[0];
  if (!i) return "Dados inválidos.";
  if (i.code === "unrecognized_keys") return `Campo não permitido: ${i.keys.join(", ")}.`;
  const campo = def.campos.find((c) => c.key === i.path[0])?.label;
  return campo ? `${campo}: ${i.message}` : i.message;
}
