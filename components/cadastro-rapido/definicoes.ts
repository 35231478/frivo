/**
 * Definições dos CADASTROS RÁPIDOS usados com `SelectCadastroRapido` /
 * `CadastroRapidoModal` (components/ui/select-cadastro-rapido.tsx).
 *
 * Cada definição reúne: campos essenciais do mini-formulário, a chamada à API de
 * criação já existente e a permissão exigida para exibir o "+ criar". Assim
 * OS, orçamento, contrato e equipamento usam exatamente o mesmo cadastro rápido.
 */
import { formatarCpfCnpj, LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import type { CampoRapido, OpcaoCadastro, PermissaoCriar } from "@/components/ui/select-cadastro-rapido";

/** POST JSON; devolve o corpo ou lança Error com a mensagem da API. */
async function postar<T = any>(url: string, corpo: unknown, erroPadrao: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.erro ?? erroPadrao);
  return data as T;
}

/* ───────── Cliente ───────── */
export const CLIENTE = {
  entidade: { singular: "cliente", plural: "clientes" },
  permissao: { modulo: "clientes", acao: "criar" } as PermissaoCriar,
  link: "/clientes/novo",
  valoresIniciais: { tipoPessoa: "JURIDICA" },
  campos: [
    { nome: "tipoPessoa", label: "Tipo", tipo: "select", obrigatorio: true, colunas: 2,
      opcoes: [{ value: "JURIDICA", label: "Empresa (PJ)" }, { value: "FISICA", label: "Pessoa (PF)" }] },
    { nome: "cpfCnpj", label: "CPF / CNPJ", obrigatorio: true, colunas: 4, inputMode: "numeric", placeholder: "Somente números" },
    { nome: "nome", label: "Nome / Razão social", obrigatorio: true, placeholder: "Ex: Supermercado Bom Preço Ltda" },
    { nome: "nomeFantasia", label: "Nome fantasia", colunas: 3 },
    { nome: "telefone", label: "Telefone", colunas: 3, inputMode: "tel" },
  ] as CampoRapido[],
  /** Cria o cliente (POST /api/clientes). Devolve o registro bruto. */
  async criar(v: Record<string, string>) {
    const digitos = (v.cpfCnpj ?? "").replace(/\D/g, "");
    const esperado = v.tipoPessoa === "FISICA" ? 11 : 14;
    if (digitos.length !== esperado) throw new Error(v.tipoPessoa === "FISICA" ? "CPF deve ter 11 dígitos." : "CNPJ deve ter 14 dígitos.");
    return postar("/api/clientes", {
      tipoPessoa: v.tipoPessoa || "JURIDICA",
      nome: v.nome,
      nomeFantasia: v.nomeFantasia || undefined,
      cpfCnpj: formatarCpfCnpj(digitos),
      telefone: v.telefone || undefined,
    }, "Erro ao cadastrar o cliente.");
  },
  opcao(c: { id: string; nome: string; nomeFantasia?: string | null }): OpcaoCadastro {
    return { value: c.id, label: c.nomeFantasia ?? c.nome, descricao: c.nomeFantasia ? c.nome : undefined };
  },
};

/* ───────── Unidade (endereço do cliente) ───────── */
export const UNIDADE = {
  entidade: { singular: "unidade", plural: "unidades", feminino: true },
  // Unidade é endereço do cliente: quem edita o cliente pode criar.
  permissao: { modulo: "clientes", acao: "editar" } as PermissaoCriar,
  link: (clienteId: string) => `/clientes/${clienteId}/editar`,
  campos: [
    { nome: "nome", label: "Nome do local", obrigatorio: true, placeholder: "Ex: Matriz, Loja Centro, Bloco A" },
    { nome: "cep", label: "CEP", tipo: "cep", placeholder: "00000-000", colunas: 2 },
    { nome: "logradouro", label: "Endereço", placeholder: "Rua / Avenida", colunas: 4 },
    { nome: "numero", label: "Número", placeholder: "Nº", colunas: 2 },
    { nome: "cidade", label: "Cidade", colunas: 2 },
    { nome: "estado", label: "UF", tipo: "uf", colunas: 2 },
  ] as CampoRapido[],
  /** Cria a unidade (POST /api/unidades). A 1ª do cliente vira a principal. */
  criar(clienteId: string, v: Record<string, string>, principal = false) {
    return postar("/api/unidades", { ...v, clienteId, principal }, "Erro ao cadastrar a unidade.");
  },
  opcao(u: { id: string; nome: string; cidade?: string | null }): OpcaoCadastro {
    return { value: u.id, label: u.nome, descricao: u.cidade ?? undefined };
  },
};

/* ───────── Técnico / colaborador ───────── */
export const TECNICO = {
  entidade: { singular: "técnico", plural: "técnicos" },
  permissao: { modulo: "equipes", acao: "gerenciar" } as PermissaoCriar,
  link: "/colaboradores/novo",
  campos: [
    { nome: "nome", label: "Nome completo", obrigatorio: true },
    { nome: "cpf", label: "CPF", obrigatorio: true, colunas: 3, inputMode: "numeric", placeholder: "000.000.000-00" },
    { nome: "telefone", label: "Telefone", obrigatorio: true, colunas: 3, inputMode: "tel", placeholder: "(00) 00000-0000" },
  ] as CampoRapido[],
  /**
   * Cria o colaborador (POST /api/tecnicos). Com `competenciaId` (tipo de OS da
   * atividade), já o habilita nessa competência — senão ele seria filtrado da lista.
   */
  criar(v: Record<string, string>, competenciaId?: string) {
    const cpf = (v.cpf ?? "").replace(/\D/g, "");
    if (cpf.length !== 11) return Promise.reject(new Error("CPF deve ter 11 dígitos."));
    return postar("/api/tecnicos", {
      nome: v.nome,
      cpf: formatarCpfCnpj(cpf),
      telefone: v.telefone,
      competenciaIds: competenciaId ? [competenciaId] : [],
    }, "Erro ao cadastrar o técnico.");
  },
};

/* ───────── Equipamento ───────── */
export const EQUIPAMENTO = {
  entidade: { singular: "equipamento", plural: "equipamentos" },
  permissao: { modulo: "equipamentos", acao: "criar" } as PermissaoCriar,
  link: "/equipamentos/novo",
  /** `unidades` só é pedido quando o contexto não define a unidade (ex.: OS sem endereço). */
  campos(unidades?: OpcaoCadastro[]): CampoRapido[] {
    return [
      ...(unidades ? [{ nome: "unidadeId", label: "Unidade / endereço", tipo: "select", obrigatorio: true,
        opcoes: unidades.map((u) => ({ value: u.value, label: u.label })) } as CampoRapido] : []),
      { nome: "tipo", label: "Tipo", tipo: "select", obrigatorio: true, placeholder: "Selecione o tipo",
        opcoes: Object.entries(LABELS_TIPO_EQUIPAMENTO).map(([value, label]) => ({ value, label })) },
      { nome: "marca", label: "Marca", obrigatorio: true, colunas: 3, placeholder: "Ex: LG, Carrier" },
      { nome: "modelo", label: "Modelo", obrigatorio: true, colunas: 3 },
      { nome: "numeroSerie", label: "Nº de série", colunas: 3 },
      { nome: "localizacao", label: "Ambiente", colunas: 3, placeholder: "Ex: Recepção" },
    ];
  },
  criar(unidadeId: string, v: Record<string, string>) {
    return postar("/api/equipamentos", {
      unidadeId: v.unidadeId || unidadeId,
      tipo: v.tipo, marca: v.marca, modelo: v.modelo,
      numeroSerie: v.numeroSerie || undefined, localizacao: v.localizacao || undefined,
    }, "Erro ao cadastrar o equipamento.");
  },
};

/* ───────── Produto / Serviço (catálogo) ───────── */
function camposCatalogo(exemplo: string): CampoRapido[] {
  return [
    { nome: "nome", label: "Nome", obrigatorio: true, placeholder: exemplo },
    { nome: "unidade", label: "Unidade", colunas: 2, placeholder: "un" },
    { nome: "valorPadrao", label: "Valor padrão (R$)", colunas: 4, inputMode: "decimal", placeholder: "0,00" },
  ];
}
function valorNumero(v?: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export const PRODUTO = {
  entidade: { singular: "produto", plural: "produtos" },
  // Catálogo de produtos/serviços é cadastro de Configurações.
  permissao: { modulo: "configuracoes", acao: "gerenciar" } as PermissaoCriar,
  link: "/configuracoes/produtos",
  campos: camposCatalogo("Ex: Filtro de ar 30x30"),
  criar(v: Record<string, string>) {
    return postar("/api/produtos", { nome: v.nome, unidade: v.unidade || "un", valorPadrao: valorNumero(v.valorPadrao) }, "Erro ao cadastrar o produto.");
  },
};

export const SERVICO = {
  entidade: { singular: "serviço", plural: "serviços" },
  permissao: { modulo: "configuracoes", acao: "gerenciar" } as PermissaoCriar,
  link: "/configuracoes/servicos",
  campos: camposCatalogo("Ex: Limpeza de split até 18.000 BTU"),
  criar(v: Record<string, string>) {
    return postar("/api/servicos", { nome: v.nome, unidade: v.unidade || "un", valorPadrao: valorNumero(v.valorPadrao) }, "Erro ao cadastrar o serviço.");
  },
};
