/**
 * Definições dos CADASTROS RÁPIDOS usados com `SelectCadastroRapido` /
 * `CadastroRapidoModal` (components/ui/select-cadastro-rapido.tsx).
 *
 * Cada definição reúne: campos essenciais do mini-formulário, a chamada à API de
 * criação já existente e a permissão exigida para exibir o "+ criar". Assim
 * OS, orçamento, contrato e equipamento usam exatamente o mesmo cadastro rápido.
 */
import { createElement } from "react";
import { formatarCpfCnpj, LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { ContatosNoContexto } from "@/components/cadastro-rapido/contatos-no-contexto";
import type { CampoRapido, EdicaoDoSelecionado, OpcaoCadastro, PermissaoCriar } from "@/components/ui/select-cadastro-rapido";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

/** POST JSON; devolve o corpo ou lança Error com a mensagem da API. */
async function postar<T = any>(url: string, corpo: unknown, erroPadrao: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.erro ?? erroPadrao);
  return data as T;
}

/** PATCH JSON (edição parcial): manda só o que mudou; devolve o registro ou lança Error com a mensagem da API. */
async function alterar<T = any>(url: string, corpo: unknown, erroPadrao: string): Promise<T> {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.erro ?? erroPadrao);
  return data as T;
}

/** GET JSON; devolve o corpo ou lança Error com a mensagem da API. */
async function ler<T = any>(url: string, erroPadrao: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.erro ?? erroPadrao);
  return data as T;
}
/** Só os campos que mudaram (o corpo da edição parcial). */
const soOQueMudou = (v: Record<string, string>, alterados: string[]) => Object.fromEntries(alterados.map((k) => [k, v[k]]));
/** Os campos do formulário a partir do registro (nulo vira vazio). */
const valoresDe = (registro: Record<string, unknown>, campos: readonly CampoRapido[]) => Object.fromEntries(campos.map((c) => [c.nome, registro?.[c.nome] == null ? "" : String(registro[c.nome])]));

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
  /**
   * Editar no contexto (de dentro da OS e do orçamento): telefone, celular e e-mail do CADASTRO do cliente,
   * com os contatos logo abaixo. Muda em todo lugar — o painel diz isso. O resto fica no cadastro completo.
   */
  permissaoEditar: { modulo: "clientes", acao: "editar" } as PermissaoCriar,
  camposEdicao: [
    { nome: "telefone", label: "Telefone", colunas: 3, inputMode: "tel", placeholder: "(00) 0000-0000" },
    { nome: "celular", label: "Celular", colunas: 3, inputMode: "tel", placeholder: "(00) 00000-0000" },
    { nome: "email", label: "E-mail", inputMode: "email", placeholder: "contato@empresa.com.br" },
  ] as CampoRapido[],
  edicao(opcoes: { aoSalvar?: (c: { id: string }) => void; aoMudarContatos?: () => void } = {}): EdicaoDoSelecionado {
    return {
      escopo: "referencia", alvo: "do cliente", campos: CLIENTE.camposEdicao, permissao: CLIENTE.permissaoEditar,
      linkCadastroCompleto: (id) => `/clientes/${id}/editar`, mensagemSucesso: "Cliente atualizado.",
      valores: async (id) => valoresDe(await ler(`/api/clientes/${id}`, "Não foi possível carregar o cliente."), CLIENTE.camposEdicao),
      async salvar(id, v, alterados) {
        opcoes.aoSalvar?.(await alterar(`/api/clientes/${id}`, soOQueMudou(v, alterados), "Erro ao salvar o cliente."));
      },
      extra: (id) => createElement(ContatosNoContexto, { clienteId: id, aoMudar: opcoes.aoMudarContatos }),
    };
  },
};

/* ───────── Contato do cliente (o "A/C" do orçamento) ───────── */
export const CONTATO = {
  permissao: { modulo: "clientes", acao: "editar" } as PermissaoCriar,
  campos: [
    { nome: "nome", label: "Nome", obrigatorio: true },
    { nome: "cargo", label: "Cargo", colunas: 3 },
    { nome: "telefone", label: "Telefone", colunas: 3, inputMode: "tel" },
    { nome: "email", label: "E-mail", inputMode: "email" },
  ] as CampoRapido[],
  /** Editar no contexto o contato escolhido: é o cadastro do cliente (referência). */
  edicao<T extends { id: string; nome: string }>(clienteId: string, contatos: readonly T[], aoSalvar: (c: T) => void): EdicaoDoSelecionado {
    return {
      escopo: "referencia", alvo: "do contato", campos: CONTATO.campos, permissao: CONTATO.permissao,
      linkCadastroCompleto: `/clientes/${clienteId}/editar`, mensagemSucesso: "Contato atualizado.",
      valores: async (id) => {
        const lista = await ler<Record<string, unknown>[]>(`/api/clientes/${clienteId}/contatos`, "Não foi possível carregar o contato.");
        return valoresDe(lista.find((c) => c.id === id) ?? contatos.find((c) => c.id === id) ?? {}, CONTATO.campos);
      },
      async salvar(id, v, alterados) {
        const c = await alterar<T>(`/api/clientes/${clienteId}/contatos/${id}`, soOQueMudou(v, alterados), "Erro ao salvar o contato.");
        aoSalvar(c);
        return { value: c.id, label: c.nome };
      },
    };
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
  /** Editar no contexto: nome e endereço do CADASTRO da unidade (muda em todo lugar). */
  camposEdicao: [
    { nome: "nome", label: "Nome do local", obrigatorio: true },
    { nome: "cep", label: "CEP", placeholder: "00000-000", colunas: 2, inputMode: "numeric" },
    { nome: "logradouro", label: "Endereço", placeholder: "Rua / Avenida", colunas: 4 },
    { nome: "numero", label: "Número", colunas: 2 },
    { nome: "complemento", label: "Complemento", colunas: 4 },
    { nome: "bairro", label: "Bairro", colunas: 2 },
    { nome: "cidade", label: "Cidade", colunas: 2 },
    { nome: "estado", label: "UF", tipo: "uf", colunas: 2 },
  ] as CampoRapido[],
  edicao<T extends { id: string; nome: string; cidade?: string | null }>(clienteId: string, aoSalvar: (u: T) => void): EdicaoDoSelecionado {
    return {
      escopo: "referencia", alvo: "da unidade", campos: UNIDADE.camposEdicao, permissao: UNIDADE.permissao,
      linkCadastroCompleto: clienteId ? UNIDADE.link(clienteId) : undefined, mensagemSucesso: "Unidade atualizada.",
      valores: async (id) => valoresDe(await ler(`/api/unidades/${id}`, "Não foi possível carregar a unidade."), UNIDADE.camposEdicao),
      async salvar(id, v, alterados) {
        const u = await alterar<T>(`/api/unidades/${id}`, soOQueMudou(v, alterados), "Erro ao salvar a unidade.");
        aoSalvar(u);
        return UNIDADE.opcao(u);
      },
    };
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

/* ───────── Tipo de OS (UX-8/Y3: sem sair da Nova OS ou da atividade) ───────── */
export const TIPO_OS = {
  entidade: { singular: "tipo de OS", plural: "tipos de OS" },
  permissao: { modulo: "configuracoes", acao: "gerenciar" } as PermissaoCriar,
  link: hrefSecaoConfig("tipos-os"),
  campos: [
    { nome: "nome", label: "Nome do tipo", obrigatorio: true, placeholder: "Ex: Higienização" },
  ] as CampoRapido[],
  criar(v: Record<string, string>) {
    return postar("/api/tipos-os", { nome: v.nome }, "Erro ao cadastrar o tipo de OS.");
  },
  /**
   * Editar no contexto (sem sair da OS): muda o CADASTRO do tipo, em todas as OS — o painel diz isso
   * ("Editando o cadastro do tipo de OS"). Só os campos simples; a regra do equipamento e os
   * formulários ficam no cadastro completo.
   */
  camposEdicao: [
    { nome: "nome", label: "Nome do tipo", obrigatorio: true },
    { nome: "descricao", label: "Descrição", tipo: "textarea" },
    { nome: "cor", label: "Cor", tipo: "cor", colunas: 2 },
  ] as CampoRapido[],
  edicao<T extends { id: string; nome: string; descricao?: string | null; cor?: string | null }>(tipos: readonly T[], aoSalvar: (t: T) => void): EdicaoDoSelecionado {
    return {
      escopo: "referencia", alvo: "do tipo de OS", campos: TIPO_OS.camposEdicao, permissao: TIPO_OS.permissao,
      linkCadastroCompleto: TIPO_OS.link, mensagemSucesso: "Tipo de OS atualizado.",
      valores: (id) => { const t = tipos.find((x) => x.id === id); return { nome: t?.nome ?? "", descricao: t?.descricao ?? "", cor: t?.cor ?? "" }; },
      async salvar(id, v, alterados) {
        const t = await alterar<T>(`/api/cadastros/tipos-os/${id}`, Object.fromEntries(alterados.map((k) => [k, v[k]])), "Erro ao salvar o tipo de OS.");
        aoSalvar(t);
        return { value: t.id, label: t.nome };
      },
    };
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
      { nome: "numeroSerie", label: "Nº de série", colunas: 3, avisoSerie: true },
      { nome: "localizacao", label: "Ambiente", colunas: 3, placeholder: "Ex: Recepção" },
    ];
  },
  criar(unidadeId: string, v: Record<string, string>) {
    return postar("/api/equipamentos", {
      unidadeId: v.unidadeId || unidadeId,
      tipo: v.tipo, marca: v.marca, modelo: v.modelo,
      // sem espaços nas pontas: a etiqueta digitada com espaço não vira "outra" série
      numeroSerie: v.numeroSerie?.trim() || undefined, localizacao: v.localizacao || undefined,
    }, "Erro ao cadastrar o equipamento.");
  },
  /**
   * Editar no contexto: a identificação do CADASTRO do equipamento (muda em todo lugar). Tipo, unidade,
   * fotos e dados técnicos ficam no cadastro completo.
   */
  permissaoEditar: { modulo: "equipamentos", acao: "editar" } as PermissaoCriar,
  camposEdicao: [
    { nome: "nome", label: "Identificação", placeholder: "Ex: Split da recepção" },
    { nome: "marca", label: "Marca", obrigatorio: true, colunas: 3 },
    { nome: "modelo", label: "Modelo", obrigatorio: true, colunas: 3 },
    { nome: "numeroSerie", label: "Nº de série", colunas: 3 },
    { nome: "patrimonio", label: "Patrimônio", colunas: 3 },
    { nome: "localizacao", label: "Ambiente", placeholder: "Ex: Recepção" },
  ] as CampoRapido[],
  edicao<T extends { id: string }>(aoSalvar: (e: T) => void): EdicaoDoSelecionado {
    return {
      escopo: "referencia", alvo: "do equipamento", campos: EQUIPAMENTO.camposEdicao, permissao: EQUIPAMENTO.permissaoEditar,
      linkCadastroCompleto: (id) => `/equipamentos/${id}`, mensagemSucesso: "Equipamento atualizado.",
      valores: async (id) => valoresDe(await ler(`/api/equipamentos/${id}`, "Não foi possível carregar o equipamento."), EQUIPAMENTO.camposEdicao),
      async salvar(id, v, alterados) {
        aoSalvar(await alterar<T>(`/api/equipamentos/${id}`, soOQueMudou(v, alterados), "Erro ao salvar o equipamento."));
      },
    };
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
  link: hrefSecaoConfig("produtos"),
  campos: camposCatalogo("Ex: Filtro de ar 30x30"),
  criar(v: Record<string, string>) {
    return postar("/api/produtos", { nome: v.nome, unidade: v.unidade || "un", valorPadrao: valorNumero(v.valorPadrao) }, "Erro ao cadastrar o produto.");
  },
};

export const SERVICO = {
  entidade: { singular: "serviço", plural: "serviços" },
  permissao: { modulo: "configuracoes", acao: "gerenciar" } as PermissaoCriar,
  link: hrefSecaoConfig("servicos"),
  campos: camposCatalogo("Ex: Limpeza de split até 18.000 BTU"),
  criar(v: Record<string, string>) {
    return postar("/api/servicos", { nome: v.nome, unidade: v.unidade || "un", valorPadrao: valorNumero(v.valorPadrao) }, "Erro ao cadastrar o serviço.");
  },
};
