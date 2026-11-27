/**
 * Importação por planilha — configuração de cada cadastro (colunas, dedup, validação). Puro.
 * Produtos, serviços e fornecedores validam pelos MESMOS schemas do cadastro padronizado
 * (lib/cadastros/registro.ts): o que a tela recusa, a planilha também recusa.
 */
import type { Celula } from "@/lib/folha/planilha";
import { CADASTROS, camposSemPermissao, mensagemValidacao, type DefCadastro, type Requisito } from "@/lib/cadastros/registro";
import { rotuloPermissao, type Acao } from "@/lib/permissoes";
import { digitos, formatarDocumento, tipoDocumento } from "@/lib/documento";
import { LABELS_ORIGEM, LABELS_PERIODICIDADE, LABELS_SEGMENTO, LABELS_TIPO_CONTATO, LABELS_TIPO_CONTRATO, LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { normalizarCodigoProduto, normalizarCodigoServico } from "@/lib/cadastros/codigos";
import {
  chaveNome, numero, opcao, texto, tipoChave, type ColunaImportacao, type ContextoImportacao, type DefImportacao, type LinhaAnalisada, type OpcaoRef, type ResultadoLinha,
} from "@/lib/importacao/motor";
import { padronizarNome, padronizarEmail, apararTextoLivre } from "@/lib/texto/normalizar";
import { cpfValido } from "@/lib/documento";
import { arred } from "@/lib/estoque/regras";
import { podeVerCustoDeCompra } from "@/lib/estoque/custo-acesso";
import { LABELS_FUNCAO } from "@/lib/colaborador-listagem";

/** Padroniza um texto opcional da planilha; mantém undefined quando ausente. */
const pNome = (s: string | undefined) => (s ? padronizarNome(s) : s);
const pLivre = (s: string | undefined) => (s ? apararTextoLivre(s) : s);

export const ENTIDADES_IMPORTACAO = ["clientes", "unidades", "contatos", "equipamentos", "fornecedores", "servicos", "produtos", "estoque", "colaboradores", "veiculos", "contratos", "pmocs"] as const;
export type EntidadeImportacao = (typeof ENTIDADES_IMPORTACAO)[number];
export const ehEntidadeImportacao = (v: string): v is EntidadeImportacao => (ENTIDADES_IMPORTACAO as readonly string[]).includes(v);

/**
 * Planilhas da mesma família, ligadas pelo CNPJ/CPF do cliente — importadas nesta ordem
 * (clientes → unidades → contatos). O botão "Importar planilha" de Clientes deixa escolher qual.
 */
export const FAMILIAS_IMPORTACAO: Partial<Record<EntidadeImportacao, EntidadeImportacao[]>> = {
  clientes: ["clientes", "unidades", "contatos", "equipamentos"],
};

/** Planilhas de um MÓDULO de produto: com o módulo desligado na empresa, nem aparecem nem importam. */
export const MODULO_DA_IMPORTACAO: Partial<Record<EntidadeImportacao, string>> = { equipamentos: "equipamentos", estoque: "estoque", veiculos: "veiculos", contratos: "contratos", pmocs: "pmoc" };
export const familiaDe = (e: EntidadeImportacao): EntidadeImportacao[] => FAMILIAS_IMPORTACAO[e] ?? [e];

/**
 * Unidade e contato são parte do cadastro do cliente: a tela exige "Clientes › Editar" para criá-los
 * (e a importação também). Aqui, e não no servidor, para a tela esconder a opção de quem não pode.
 */
export const REQUISITO_FAMILIA: Partial<Record<EntidadeImportacao, Requisito>> = {
  unidades: [["clientes", "editar"]],
  contatos: [["clientes", "editar"]],
  equipamentos: [["equipamentos", "criar"]],
};

/* ───────── Peças ───────── */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const opcoesDeLabels = (m: Record<string, string>): OpcaoRef[] => Object.entries(m).map(([valor, rotulo]) => ({ valor, rotulo }));
/** Apelidos de unidade que as pessoas digitam */
const APELIDOS_UNIDADE: Record<string, string[]> = {
  un: ["und", "unid", "unidade", "pc", "peca", "peça"], kg: ["quilo", "quilograma", "kilo"],
  m: ["metro", "metro linear", "mt"], m2: ["m²", "metro quadrado"], hora: ["h", "horas", "hr"],
};
const unidadesDe = (def: DefCadastro): OpcaoRef[] =>
  (def.campos.find((c) => c.key === "unidade")?.opcoes ?? []).map((o) => ({ valor: o.value, rotulo: o.label, aceitos: APELIDOS_UNIDADE[o.value] ?? [] }));
export const UNIDADES_PRODUTO = unidadesDe(CADASTROS.produtos);
export const UNIDADES_SERVICO = unidadesDe(CADASTROS.servicos);

/** Número de uma coluna: vazio = não informado; texto que não é número = erro (nunca vira zero). */
function lerNumero(v: Celula, campo: string, erros: string[], o: { inteiro?: boolean } = {}) {
  const n = numero(v);
  if (n === undefined) return undefined;
  if (Number.isNaN(n)) { erros.push(`${campo}: “${String(v).trim()}” não é um número.`); return undefined; }
  if (o.inteiro && !Number.isInteger(n)) { erros.push(`${campo}: use um número inteiro (veio ${n}).`); return undefined; }
  return n;
}

/**
 * Valida os campos INFORMADOS pelo schema de edição do cadastro (sem padrões: vazio continua vazio,
 * e ao atualizar não apaga nada). Os padrões de criação são aplicados só na hora de criar.
 */
function validarPeloCadastro(
  def: DefCadastro, dados: Record<string, unknown>, erros: string[], rotulo: string, chaves: string[], ctx: ContextoImportacao,
): ResultadoLinha {
  const informados = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
  const r = def.schemaEditar.safeParse(informados);
  if (!r.success) erros.push(mensagemValidacao(r.error, def));
  // Campo com permissão própria (ex.: dados fiscais da NFS-e): preenchido sem ela = erro na linha (sem contexto = sem permissão)
  const travados = camposSemPermissao(def, ctx.permitido ?? (() => false), informados);
  if (travados.length)
    erros.push(`${travados.map((c) => c.label).join(", ")}: exige a permissão ${rotuloPermissao(travados[0].permissao!)}. Deixe essas colunas vazias ou peça a quem tem a permissão.`);
  return erros.length ? { ok: false, erros, rotulo } : { ok: true, dados: r.success ? r.data : informados, chaves, rotulo };
}

/** Documento opcional/obrigatório: só dígitos e com dígitos verificadores válidos. */
function lerDocumento(v: Celula, erros: string[], obrig: boolean) {
  const t = texto(v);
  if (!t) { if (obrig) erros.push("cnpj_cpf: obrigatório."); return undefined; }
  if (!tipoDocumento(t)) { erros.push(`cnpj_cpf: “${t}” não é um CNPJ (14 dígitos) nem um CPF (11 dígitos) válido.`); return undefined; }
  return digitos(t);
}

/* ───────── Chave da planilha exportada (round-trip) ───────── */
/**
 * id_sistema: o id do registro, que vem na planilha EXPORTADA. É a 1ª chave do reupload — a linha
 * ATUALIZA esse registro mesmo que o nome, o código ou o documento tenham mudado. Precisa ser de um
 * registro DESTA empresa (senão, erro: nunca vira um cadastro novo nem toca em outra empresa).
 */
const COLUNA_ID: ColunaImportacao = {
  // Só "id_sistema"/"id_interno": uma coluna "id" de outro sistema não pode virar chave por engano
  chave: "id_sistema", titulo: "id_sistema", exemplo: "", apelidos: ["id_interno"],
  ajuda: "Vem na planilha exportada: identifica o registro. NÃO altere — é ela que faz a linha atualizar em vez de duplicar. Linha nova: deixe vazia.",
};
function lerId(v: Celula, erros: string[]) {
  const t = texto(v);
  if (!t) return undefined;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(t)) { erros.push(`id_sistema: “${t}” não é um identificador do sistema. Não altere essa coluna (linha nova: deixe vazia).`); return undefined; }
  return t;
}
const chaveIdQueExiste = (singular: string, feminino = false) => ({
  prefixo: "id:", erro: (id: string) => `id_sistema “${id}” não é de ${feminino ? "nenhuma" : "nenhum"} ${singular} desta empresa. Não altere essa coluna; para cadastrar ${feminino ? "uma nova" : "um novo"}, deixe-a vazia.`,
});
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** Número para a planilha no formato BR, que a importação lê de volta ("1250,5" / "250,00") */
const num = (v: unknown, casas?: number) => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? (casas === undefined ? String(n) : n.toFixed(casas)).replace(".", ",") : "";
};
const rotuloDe = (opcoes: OpcaoRef[], valor: unknown) => opcoes.find((o) => o.valor === valor)?.rotulo ?? txt(valor);

/* ───────── Clientes (dedup por id_sistema, depois CNPJ/CPF) ───────── */
const clientes: DefImportacao = {
  entidade: "clientes", singular: "cliente", plural: "clientes", chaveDescricao: "id_sistema ou CNPJ/CPF",
  avisoPrevia: "Cada cliente novo (e cada cliente sem nenhuma unidade) ganha a unidade “Principal” com o endereço dele. Outras unidades e os contatos entram pelas planilhas de unidades e de contatos.",
  colunas: [
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Razão social ou nome completo", exemplo: "Hospital Santa Clara Ltda", apelidos: ["razao_social", "nome_razao_social", "cliente"] },
    { chave: "cnpj_cpf", titulo: "cnpj_cpf", obrig: true, ajuda: "CNPJ ou CPF, com ou sem pontuação. Chave para não duplicar.", exemplo: "11.222.333/0001-81", apelidos: ["cnpj", "cpf", "cpf_cnpj", "documento"] },
    { chave: "nome_fantasia", titulo: "nome_fantasia", ajuda: "Nome fantasia", exemplo: "Hospital Santa Clara", apelidos: ["fantasia"] },
    { chave: "tipo_pessoa", titulo: "tipo_pessoa", ajuda: "Vazio = pelo documento (CPF = física, CNPJ = jurídica)", exemplo: "Jurídica", opcoes: ["Física", "Jurídica"], apelidos: ["tipo", "pessoa"] },
    { chave: "inscricao_estadual", titulo: "inscricao_estadual", ajuda: "Inscrição estadual", exemplo: "", apelidos: ["ie"] },
    { chave: "email", titulo: "email", ajuda: "E-mail principal", exemplo: "financeiro@santaclara.com.br", apelidos: ["e_mail"] },
    { chave: "telefone", titulo: "telefone", ajuda: "Telefone fixo", exemplo: "(31) 3333-4444", apelidos: ["fone"] },
    { chave: "celular", titulo: "celular", ajuda: "Celular / WhatsApp", exemplo: "(31) 99999-0000", apelidos: ["whatsapp"] },
    { chave: "contato", titulo: "contato", ajuda: "Pessoa de contato", exemplo: "Maria (compras)", apelidos: ["responsavel"] },
    { chave: "cep", titulo: "cep", ajuda: "CEP (8 dígitos)", exemplo: "30140-000" },
    { chave: "endereco", titulo: "endereco", ajuda: "Rua / avenida", exemplo: "Av. Afonso Pena", apelidos: ["logradouro", "rua"] },
    { chave: "numero", titulo: "numero", ajuda: "Número", exemplo: "1500", apelidos: ["n", "num"] },
    { chave: "complemento", titulo: "complemento", ajuda: "Complemento", exemplo: "Bloco B" },
    { chave: "bairro", titulo: "bairro", ajuda: "Bairro", exemplo: "Centro" },
    { chave: "cidade", titulo: "cidade", ajuda: "Cidade", exemplo: "Belo Horizonte", apelidos: ["municipio"] },
    { chave: "estado", titulo: "estado", ajuda: "UF (sigla)", exemplo: "MG", opcoes: UFS, apelidos: ["uf"] },
    { chave: "segmento", titulo: "segmento", ajuda: "Segmento do cliente", exemplo: "Saúde", opcoes: Object.values(LABELS_SEGMENTO) },
    { chave: "origem", titulo: "origem", ajuda: "Como o cliente chegou", exemplo: "Indicação", opcoes: Object.values(LABELS_ORIGEM) },
    { chave: "tabela_preco", titulo: "tabela_preco", ajuda: "Nome de uma tabela de preços ATIVA (vazio = Padrão)", exemplo: "", apelidos: ["tabela", "tabela_de_precos"] },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações", exemplo: "", apelidos: ["obs", "observacao"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("cliente")],
  exportar: (c, refs) => ({
    nome: txt(c.nome), cnpj_cpf: txt(c.cpfCnpj), nome_fantasia: txt(c.nomeFantasia),
    tipo_pessoa: c.tipoPessoa === "FISICA" ? "Física" : c.tipoPessoa === "JURIDICA" ? "Jurídica" : "",
    inscricao_estadual: txt(c.inscricaoEstadual), email: txt(c.email), telefone: txt(c.telefone), celular: txt(c.celular), contato: txt(c.contato),
    cep: txt(c.cep), endereco: txt(c.endereco), numero: txt(c.numero), complemento: txt(c.complemento), bairro: txt(c.bairro),
    cidade: txt(c.cidade), estado: txt(c.estado),
    segmento: c.segmento ? LABELS_SEGMENTO[c.segmento as string] ?? txt(c.segmento) : "", origem: c.origem ? LABELS_ORIGEM[c.origem as string] ?? txt(c.origem) : "",
    tabela_preco: c.tabelaPrecoId ? rotuloDe(refs.tabela_preco ?? [], c.tabelaPrecoId) : "",
    observacoes: txt(c.observacoes), id_sistema: txt(c.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const doc = lerDocumento(v.cnpj_cpf, erros, true);
    const tipoDoc = doc ? (doc.length === 11 ? "FISICA" : "JURIDICA") : undefined;
    const tipo = opcao(v.tipo_pessoa, [{ valor: "FISICA", rotulo: "Física", aceitos: ["pf", "fisica", "pessoa fisica"] }, { valor: "JURIDICA", rotulo: "Jurídica", aceitos: ["pj", "juridica", "pessoa juridica"] }], "tipo_pessoa");
    if (tipo.erro) erros.push(tipo.erro);
    if (tipo.valor && tipoDoc && tipo.valor !== tipoDoc) erros.push(`tipo_pessoa: “${texto(v.tipo_pessoa)}” não combina com o documento (${tipoDoc === "FISICA" ? "CPF = pessoa física" : "CNPJ = pessoa jurídica"}).`);
    const email = texto(v.email);
    if (email && !EMAIL.test(email)) erros.push(`email: “${email}” não é um e-mail válido.`);
    const cep = texto(v.cep);
    if (cep && digitos(cep).length !== 8) erros.push(`cep: “${cep}” precisa ter 8 dígitos.`);
    const uf = opcao(v.estado, UFS.map((u) => ({ valor: u, rotulo: u })), "estado");
    const seg = opcao(v.segmento, opcoesDeLabels(LABELS_SEGMENTO), "segmento");
    const ori = opcao(v.origem, opcoesDeLabels(LABELS_ORIGEM), "origem");
    const tab = opcao(v.tabela_preco, ctx.refs.tabela_preco ?? [], "tabela_preco");
    for (const r of [uf, seg, ori, tab]) if (r.erro) erros.push(r.erro);
    if (erros.length) return { ok: false, erros, rotulo };
    return {
      ok: true, rotulo, chaves: [...(id ? [`id:${id}`] : []), `doc:${doc}`],
      dados: {
        nome: padronizarNome(rotulo), cpfCnpj: formatarDocumento(doc!), tipoPessoa: tipo.valor ?? tipoDoc,
        nomeFantasia: pNome(texto(v.nome_fantasia)), inscricaoEstadual: texto(v.inscricao_estadual),
        email: email ? padronizarEmail(email) : undefined, telefone: texto(v.telefone), celular: texto(v.celular), contato: pNome(texto(v.contato)),
        cep: cep ? digitos(cep).replace(/(\d{5})(\d{3})/, "$1-$2") : undefined,
        endereco: pNome(texto(v.endereco)), numero: texto(v.numero), complemento: pNome(texto(v.complemento)), bairro: pNome(texto(v.bairro)),
        cidade: pNome(texto(v.cidade)), estado: uf.valor, segmento: seg.valor, origem: ori.valor, tabelaPrecoId: tab.valor,
        observacoes: pLivre(texto(v.observacoes)),
      },
    };
  },
};

/* ───────── Unidades e contatos: ligados ao cliente pelo CNPJ/CPF ───────── */
const SIM_NAO: OpcaoRef[] = [{ valor: "sim", rotulo: "Sim", aceitos: ["s", "x", "1", "true", "verdadeiro", "principal"] }, { valor: "nao", rotulo: "Não", aceitos: ["n", "0", "false", "falso"] }];
const COLUNA_CLIENTE: ColunaImportacao = {
  chave: "cnpj_cpf", titulo: "cnpj_cpf", obrig: true, ajuda: "CNPJ ou CPF do cliente (já cadastrado — importe os clientes primeiro). É o que liga a linha ao cliente.",
  exemplo: "11.222.333/0001-81", apelidos: ["cnpj", "cpf", "cpf_cnpj", "documento", "cnpj_cliente", "cpf_cnpj_cliente", "documento_cliente"],
};
/** O cliente da linha, pelo documento (só da empresa da sessão). */
function lerCliente(v: Celula, erros: string[], ctx: ContextoImportacao) {
  const doc = lerDocumento(v, erros, true);
  if (!doc) return undefined;
  const id = ctx.mapas?.clientes?.get(doc);
  if (!id) erros.push(`cnpj_cpf: nenhum cliente com o ${doc.length === 11 ? "CPF" : "CNPJ"} ${formatarDocumento(doc)} nesta empresa. Importe a planilha de clientes primeiro.`);
  return id;
}
/** "principal": Sim / Não / vazio (não muda). */
function lerPrincipal(v: Celula, erros: string[]) {
  const r = opcao(v, SIM_NAO, "principal");
  if (r.erro) erros.push(r.erro);
  return r.valor === undefined ? undefined : r.valor === "sim";
}
/** Duas linhas marcando "principal" para o MESMO cliente: só a 1ª vale (a outra vira erro). */
function umPrincipalPorCliente(rotulo: string) {
  return (linhas: LinhaAnalisada[]) => {
    const vistos = new Map<string, number>();
    const erros = new Map<number, string>();
    for (const l of linhas) {
      if (l.dados?.principal !== true) continue;
      const c = String(l.dados.clienteId);
      if (vistos.has(c)) erros.set(l.linha, `principal: a linha ${vistos.get(c)} já marca ${rotulo} principal deste cliente (só pode haver um).`);
      else vistos.set(c, l.linha);
    }
    return erros;
  };
}

const unidades: DefImportacao = {
  entidade: "unidades", singular: "unidade", plural: "unidades", feminino: true, chaveDescricao: "id_sistema ou nome da unidade no mesmo cliente",
  avisoPrevia: "Marcar uma unidade como principal tira a marcação da principal anterior do mesmo cliente.",
  colunas: [
    COLUNA_CLIENTE,
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome da unidade (local de atendimento). Mesmo nome no mesmo cliente = atualiza. A unidade criada junto com o cliente se chama “Principal”.", exemplo: "Bloco Cirúrgico", apelidos: ["unidade", "nome_unidade", "local", "filial", "nome_do_local"] },
    { chave: "principal", titulo: "principal", ajuda: "Sim = vira o endereço principal do cliente (só um por cliente; a anterior deixa de ser). Não ou vazio = não muda — o cliente nunca fica sem endereço principal.", exemplo: "Não", opcoes: SIM_NAO.map((o) => o.rotulo), apelidos: ["e_principal", "endereco_principal"] },
    { chave: "cep", titulo: "cep", ajuda: "CEP (8 dígitos)", exemplo: "30140-000" },
    { chave: "endereco", titulo: "endereco", ajuda: "Rua / avenida", exemplo: "Rua das Acácias", apelidos: ["logradouro", "rua"] },
    { chave: "numero", titulo: "numero", ajuda: "Número", exemplo: "140", apelidos: ["n", "num"] },
    { chave: "complemento", titulo: "complemento", ajuda: "Complemento", exemplo: "Térreo" },
    { chave: "bairro", titulo: "bairro", ajuda: "Bairro", exemplo: "Centro" },
    { chave: "cidade", titulo: "cidade", ajuda: "Cidade", exemplo: "Belo Horizonte", apelidos: ["municipio"] },
    { chave: "estado", titulo: "estado", ajuda: "UF (sigla)", exemplo: "MG", opcoes: UFS, apelidos: ["uf"] },
    { chave: "telefone", titulo: "telefone", ajuda: "Telefone da unidade", exemplo: "(31) 3222-1000", apelidos: ["fone"] },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações (acesso, portaria, horário…)", exemplo: "", apelidos: ["obs", "observacao"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("unidade", true)],
  conferirPlanilha: umPrincipalPorCliente("a unidade"),
  exportar: (u) => ({
    cnpj_cpf: txt((u.cliente as { cpfCnpj?: string } | undefined)?.cpfCnpj), nome: txt(u.nome), principal: u.principal ? "Sim" : "Não",
    cep: txt(u.cep), endereco: txt(u.logradouro), numero: txt(u.numero), complemento: txt(u.complemento), bairro: txt(u.bairro),
    cidade: txt(u.cidade), estado: txt(u.estado), telefone: txt(u.telefone), observacoes: txt(u.observacoes), id_sistema: txt(u.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const clienteId = lerCliente(v.cnpj_cpf, erros, ctx);
    // id_sistema de uma unidade de OUTRO cliente: não move unidade de cliente
    if (id && clienteId && ctx.mapas?.unidadeDoCliente?.has(id) && ctx.mapas.unidadeDoCliente.get(id) !== clienteId)
      erros.push(`id_sistema “${id}” é de uma unidade de outro cliente. Uma unidade não muda de cliente pela planilha.`);
    const principal = lerPrincipal(v.principal, erros);
    const cep = texto(v.cep);
    if (cep && digitos(cep).length !== 8) erros.push(`cep: “${cep}” precisa ter 8 dígitos.`);
    const uf = opcao(v.estado, UFS.map((u) => ({ valor: u, rotulo: u })), "estado");
    if (uf.erro) erros.push(uf.erro);
    if (erros.length) return { ok: false, erros, rotulo };
    return {
      ok: true, rotulo, chaves: [...(id ? [`id:${id}`] : []), `un:${clienteId}|${chaveNome(rotulo)}`],
      dados: {
        clienteId, nome: padronizarNome(rotulo), principal,
        cep: cep ? digitos(cep).replace(/(\d{5})(\d{3})/, "$1-$2") : undefined,
        logradouro: pNome(texto(v.endereco)), numero: texto(v.numero), complemento: pNome(texto(v.complemento)), bairro: pNome(texto(v.bairro)),
        cidade: pNome(texto(v.cidade)), estado: uf.valor, telefone: texto(v.telefone), observacoes: pLivre(texto(v.observacoes)),
      },
    };
  },
};

const TIPOS_CONTATO: OpcaoRef[] = Object.entries(LABELS_TIPO_CONTATO).map(([valor, rotulo]) => ({
  valor, rotulo, aceitos: valor === "OPERACIONAL" ? ["chamados", "operacao"] : valor === "DIRETORIA" ? ["diretor", "diretora", "dono", "socio"] : [],
}));
const contatos: DefImportacao = {
  entidade: "contatos", singular: "contato", plural: "contatos", chaveDescricao: "id_sistema, e-mail ou nome no mesmo cliente",
  avisoPrevia: "Marcar um contato como principal tira a marcação do principal anterior do mesmo cliente. O acesso ao portal não é criado pela planilha.",
  colunas: [
    COLUNA_CLIENTE,
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome da pessoa de contato", exemplo: "Marta Soares", apelidos: ["contato", "nome_contato", "responsavel"] },
    { chave: "cargo", titulo: "cargo", ajuda: "Cargo / função", exemplo: "Engenharia clínica", apelidos: ["funcao", "setor"] },
    { chave: "tipo", titulo: "tipo", ajuda: "Para que serve o contato (vazio = Outro)", exemplo: "Técnico", opcoes: TIPOS_CONTATO.map((t) => t.rotulo), apelidos: ["tipo_contato", "departamento"] },
    { chave: "email", titulo: "email", ajuda: "E-mail. Mesmo e-mail no mesmo cliente = atualiza esse contato.", exemplo: "marta@cliente.com.br", apelidos: ["e_mail"] },
    { chave: "telefone", titulo: "telefone", ajuda: "Telefone", exemplo: "(31) 3222-1000", apelidos: ["fone"] },
    { chave: "whatsapp", titulo: "whatsapp", ajuda: "WhatsApp / celular", exemplo: "(31) 99888-1000", apelidos: ["celular", "zap"] },
    { chave: "principal", titulo: "principal", ajuda: "Sim = contato principal do cliente (só um por cliente). Vazio = não muda.", exemplo: "Sim", opcoes: SIM_NAO.map((o) => o.rotulo), apelidos: ["contato_principal"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("contato")],
  conferirPlanilha: umPrincipalPorCliente("o contato"),
  exportar: (c) => ({
    cnpj_cpf: txt((c.cliente as { cpfCnpj?: string } | undefined)?.cpfCnpj), nome: txt(c.nome), cargo: txt(c.cargo),
    tipo: c.tipo ? LABELS_TIPO_CONTATO[c.tipo as string] ?? txt(c.tipo) : "", email: txt(c.email), telefone: txt(c.telefone),
    whatsapp: txt(c.whatsapp), principal: c.principal ? "Sim" : "Não", id_sistema: txt(c.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    else if (rotulo.length < 2) erros.push("nome: use pelo menos 2 letras.");
    const id = lerId(v.id_sistema, erros);
    const clienteId = lerCliente(v.cnpj_cpf, erros, ctx);
    if (id && clienteId && ctx.mapas?.contatoDoCliente?.has(id) && ctx.mapas.contatoDoCliente.get(id) !== clienteId)
      erros.push(`id_sistema “${id}” é de um contato de outro cliente. Um contato não muda de cliente pela planilha.`);
    const tipo = opcao(v.tipo, TIPOS_CONTATO, "tipo");
    if (tipo.erro) erros.push(tipo.erro);
    const email = texto(v.email);
    if (email && !EMAIL.test(email)) erros.push(`email: “${email}” não é um e-mail válido.`);
    const principal = lerPrincipal(v.principal, erros);
    if (erros.length) return { ok: false, erros, rotulo };
    const emailP = email ? padronizarEmail(email) : undefined;
    return {
      ok: true, rotulo,
      chaves: [...(id ? [`id:${id}`] : []), ...(emailP ? [`ctmail:${clienteId}|${emailP}`] : []), `ctnome:${clienteId}|${chaveNome(rotulo)}`],
      dados: {
        clienteId, nome: padronizarNome(rotulo), cargo: pNome(texto(v.cargo)), tipo: tipo.valor, email: emailP,
        telefone: texto(v.telefone), whatsapp: texto(v.whatsapp), principal,
      },
    };
  },
};

/* ───────── Equipamentos: cliente pelo CNPJ/CPF, unidade pelo nome (vazia = a principal) ───────── */
/** Apelidos que as pessoas (e outros sistemas) usam para os tipos do Frivo */
export const APELIDOS_TIPO_EQUIPAMENTO: Record<string, string[]> = {
  AR_CONDICIONADO_SPLIT: ["split", "hi wall", "hi-wall", "hiwall", "split hi wall", "split hi-wall", "parede", "split parede"],
  AR_CONDICIONADO_JANELA: ["janela", "acj", "ar de janela"],
  AR_CONDICIONADO_CENTRAL: ["central", "ar central"],
  AR_CONDICIONADO_PORTATIL: ["portatil", "portátil"],
  CASSETE: ["cassete", "cassette", "k7"],
  PISO_TETO: ["piso teto", "piso-teto", "pisoteto", "piso/teto"],
  VRF: ["vrf", "vrv", "vrf/vrv"],
  FANCOIL: ["fancoil", "fan coil", "fan-coil"],
  SELF_CONTAINED: ["self", "self contained", "self-contained"],
  CONDENSADORA: ["condensadora", "unidade externa", "condensador"],
  EVAPORADORA: ["evaporadora", "unidade interna", "evaporador"],
  CHILLER: ["chiller"],
  TORRE_RESFRIAMENTO: ["torre", "torre de resfriamento"],
  CAMARA_FRIA: ["camara fria", "câmara fria"],
  CAMARA_CLIMATIZADA: ["camara climatizada", "câmara climatizada"],
  REFRIGERADOR_COMERCIAL: ["refrigerador", "geladeira", "expositor"],
  CONGELADOR_COMERCIAL: ["congelador", "freezer"],
  OUTRO: ["outro", "outros"],
};
/** Gases conhecidos (o resto fica como veio): "r-410a", "410A" → "R410A" */
const FLUIDOS_CONHECIDOS = ["R22", "R410A", "R32", "R407C", "R404A", "R134a", "R290", "R600a", "R507A", "R417A", "R438A", "R454B"];
export function normalizarFluido(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const k = t.replace(/[\s-]/g, "").toUpperCase().replace(/^(\d)/, "R$1");
  return FLUIDOS_CONHECIDOS.find((f) => f.toUpperCase() === k) ?? t.trim();
}
/** "220", "220v", "220 V" → "220V"; o resto (ex.: "220/380") fica como veio */
export function normalizarTensao(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const m = t.trim().match(/^(\d{2,3})\s*v?$/i);
  return m ? `${m[1]}V` : t.trim();
}
const formatarBtu = (n: number) => `${Math.round(n).toLocaleString("pt-BR")} BTU/h`;
const formatarTr = (n: number) => `${String(Math.round(n * 100) / 100).replace(".", ",")} TR`;
/**
 * Capacidade no formato do cadastro ("12.000 BTU/h", "5 TR"): "12000", "12.000 btu", "36.000 BTUs",
 * "5 TR", "7,5 tr". Número sem unidade: de 1.000 para cima é BTU/h; abaixo, não dá para saber → erro.
 */
export function lerCapacidade(v: Celula): { valor?: string; erro?: string } {
  if (v == null || (typeof v === "string" && !v.trim())) return {};
  if (typeof v === "number") return v >= 1000 ? { valor: formatarBtu(v) } : { erro: `capacidade: “${v}” sem unidade — escreva BTU ou TR (ex.: 12.000 BTU, 5 TR).` };
  const t = String(v).trim();
  const m = t.match(/^([\d.,\s]+?)\s*(btu\/?h?|btus|tr|ton|toneladas?)?\.?$/i);
  const n = m ? numero(m[1].replace(/\s/g, "")) : undefined;
  if (!m || n === undefined || Number.isNaN(n) || n <= 0) return { erro: `capacidade: “${t}” não é uma capacidade (ex.: 12.000 BTU, 5 TR).` };
  const un = (m[2] ?? "").toLowerCase();
  if (un.startsWith("btu")) return { valor: formatarBtu(n) };
  if (un) return { valor: formatarTr(n) };
  return n >= 1000 ? { valor: formatarBtu(n) } : { erro: `capacidade: “${t}” sem unidade — escreva BTU ou TR (ex.: 12.000 BTU, 5 TR).` };
}
/** Série e patrimônio/TAG comparados sem espaços, hífens, pontos, barras e maiúsculas ("LGX-0001" = "lgx 0001") */
export const chaveCodigo = (t: string) => t.replace(/[\s\-./_]+/g, "").toUpperCase();
/** "Mesmo equipamento?" quando não há série nem patrimônio: cliente + unidade + marca + modelo + capacidade */
export const chaveParecido = (clienteId: string, unidadeId: string, marca: string, modelo: string, capacidade?: string | null) =>
  `${clienteId}|${unidadeId}|${chaveNome(marca)}|${chaveNome(modelo)}|${chaveNome(capacidade ?? "")}`;
const livre = (v: Celula) => { const t = texto(v); return t ? apararTextoLivre(t) : undefined; };

const equipamentos: DefImportacao = {
  entidade: "equipamentos", singular: "equipamento", plural: "equipamentos", chaveDescricao: "id_sistema, nº de série ou patrimônio/TAG",
  avisoPrevia: "Sem nº de série nem patrimônio/TAG, a linha entra com aviso: reimportar a mesma planilha criaria de novo. Os possíveis duplicados (mesmo cliente, unidade, marca, modelo e capacidade) aparecem para revisão.",
  colunas: [
    COLUNA_CLIENTE,
    { chave: "unidade", titulo: "unidade", ajuda: "Nome da unidade do cliente. Vazio = a unidade principal. Precisa já existir (importe as unidades antes).", exemplo: "", apelidos: ["nome_unidade", "local_de_atendimento", "filial"] },
    { chave: "tipo", titulo: "tipo", ajuda: "Tipo do equipamento (split, cassete, piso-teto, VRF…). Vazio = Outro, ao criar.", exemplo: "Split Hi-Wall (parede)", apelidos: ["tipo_equipamento", "categoria"] },
    { chave: "marca", titulo: "marca", obrig: true, ajuda: "Marca / fabricante", exemplo: "LG", apelidos: ["fabricante"] },
    { chave: "modelo", titulo: "modelo", obrig: true, ajuda: "Modelo", exemplo: "S4-Q12JA3WF" },
    { chave: "capacidade", titulo: "capacidade", ajuda: "Com a unidade: 12.000 BTU ou 5 TR (só o número, de 1.000 para cima, é BTU)", exemplo: "12.000 BTU", apelidos: ["btu", "btus", "capacidade_btu", "potencia_btu", "tr"] },
    { chave: "fluido", titulo: "fluido", ajuda: "Gás refrigerante (R410A, R32, R22…)", exemplo: "R410A", apelidos: ["gas", "gas_refrigerante", "refrigerante"] },
    { chave: "tensao", titulo: "tensao", ajuda: "Tensão (127V, 220V, 380V…)", exemplo: "220V", apelidos: ["voltagem", "tensao_v"] },
    { chave: "ambiente", titulo: "ambiente", ajuda: "Onde fica: sala, recepção, CPD…", exemplo: "Recepção", apelidos: ["localizacao", "local", "sala", "ambiente_local"] },
    { chave: "setor", titulo: "setor", ajuda: "Andar, bloco, setor", exemplo: "Térreo", apelidos: ["andar", "bloco", "pavimento"] },
    { chave: "numero_serie", titulo: "numero_serie", ajuda: "Nº de série (chave para não duplicar)", exemplo: "LGX-0001", apelidos: ["serie", "n_serie", "no_de_serie", "n_de_serie", "numero_de_serie", "serial"] },
    { chave: "patrimonio", titulo: "patrimonio", ajuda: "Patrimônio ou TAG / etiqueta do cliente (chave quando não há nº de série)", exemplo: "", apelidos: ["tag", "etiqueta", "patrimonio_tag", "codigo_patrimonio", "tag_patrimonio"] },
    { chave: "nome", titulo: "nome", ajuda: "Apelido do equipamento (opcional)", exemplo: "", apelidos: ["identificacao", "descricao"] },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações", exemplo: "", apelidos: ["obs", "observacao"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("equipamento")],
  avisarPlanilha(linhas) {
    // Duas linhas SEM chave e iguais: pode ser o mesmo equipamento duas vezes (ou dois iguais na sala)
    const vistos = new Map<string, number>();
    const avisos = new Map<number, string>();
    for (const l of linhas) {
      const d = l.dados;
      if (!d || d.semChave !== true) continue;
      const k = chaveParecido(String(d.clienteId), String(d.unidadeId), String(d.marca), String(d.modelo), d.capacidade as string | undefined);
      if (vistos.has(k)) avisos.set(l.linha, `Igual à linha ${vistos.get(k)} (mesmo cliente, unidade, marca, modelo e capacidade): confira se não é o mesmo equipamento.`);
      else vistos.set(k, l.linha);
    }
    return avisos;
  },
  exportar: (e, refs) => {
    const u = e.unidade as { nome?: string; principal?: boolean; cliente?: { cpfCnpj?: string } } | undefined;
    return {
      cnpj_cpf: txt(u?.cliente?.cpfCnpj), unidade: u?.principal ? "" : txt(u?.nome),
      tipo: e.tipoEquipamentoId ? rotuloDe(refs.tipo ?? [], `c:${e.tipoEquipamentoId}`) : (LABELS_TIPO_EQUIPAMENTO[e.tipo as string] ?? txt(e.tipo)),
      marca: txt(e.marca), modelo: txt(e.modelo), capacidade: txt(e.capacidade), fluido: txt(e.fluido), tensao: txt(e.tensao),
      ambiente: txt(e.localizacao), setor: txt(e.setor), numero_serie: txt(e.numeroSerie), patrimonio: txt(e.patrimonio),
      nome: txt(e.nome), observacoes: txt(e.observacoes), id_sistema: txt(e.id),
    };
  },
  validar(v, ctx) {
    const erros: string[] = [];
    const avisos: string[] = [];
    const marca = livre(v.marca);
    const modelo = livre(v.modelo);
    const ambiente = livre(v.ambiente);
    const rotulo = [marca, modelo].filter(Boolean).join(" ") + (ambiente ? ` — ${ambiente}` : "");
    if (!marca) erros.push("marca: obrigatória.");
    if (!modelo) erros.push("modelo: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const clienteId = lerCliente(v.cnpj_cpf, erros, ctx);
    // Unidade pelo nome no cliente; vazia = a principal
    const nomeUnidade = texto(v.unidade);
    let unidadeId: string | undefined;
    if (clienteId) {
      unidadeId = ctx.mapas?.unidades?.get(nomeUnidade ? `${clienteId}|${chaveNome(nomeUnidade)}` : `${clienteId}|*principal`);
      if (!unidadeId)
        erros.push(nomeUnidade
          ? `unidade: “${nomeUnidade}” não existe neste cliente. Importe a planilha de unidades antes (ou deixe vazio para a unidade principal).`
          : "unidade: este cliente não tem unidade principal. Informe o nome da unidade.");
    }
    const tipo = opcao(v.tipo, ctx.refs.tipo ?? [], "tipo");
    if (tipo.erro) erros.push(tipo.erro);
    const cap = lerCapacidade(v.capacidade);
    if (cap.erro) erros.push(cap.erro);
    const serie = texto(v.numero_serie);
    const patrimonio = texto(v.patrimonio);
    // Cada chave com o que a pessoa DIGITOU (as mensagens mostram o valor dela, não o normalizado)
    const digitado: [string, string][] = [...(id ? [[`id:${id}`, id] as [string, string]] : []), ...(serie ? [[`serie:${chaveCodigo(serie)}`, serie] as [string, string]] : []), ...(patrimonio ? [[`pat:${chaveCodigo(patrimonio)}`, patrimonio] as [string, string]] : [])];
    // Série/patrimônio que já está em MAIS de um equipamento: não dá para saber qual atualizar
    // (com o id_sistema na linha, é ele que decide)
    if (!id)
      for (const [k, valor] of digitado) {
        const n = ctx.mapas?.ambiguas?.get(k);
        if (n) erros.push(`${k.startsWith("serie:") ? "numero_serie" : "patrimonio"}: “${valor}” já está em ${n} equipamentos desta empresa — não dá para saber qual atualizar. Baixe a planilha de equipamentos e use o id_sistema.`);
      }
    // Casou com um equipamento de OUTRO cliente: um equipamento não muda de cliente pela planilha
    if (clienteId)
      for (const [k, valor] of digitado) {
        const eq = ctx.existentes.get(k);
        const dono = eq ? ctx.mapas?.equipamentoDoCliente?.get(eq) : undefined;
        if (dono && dono !== clienteId) {
          erros.push(`${tipoChave(k)} “${valor}” é de um equipamento de outro cliente. Um equipamento não muda de cliente pela planilha.`);
          break;
        }
      }
    if (erros.length) return { ok: false, erros, rotulo };
    // Com o id_sistema, série/TAG que já é repetida no cadastro não serve de chave (nem para "repete a linha")
    const chaves = digitado.filter(([k]) => !(id && ctx.mapas?.ambiguas?.has(k))).map(([k]) => k);
    const semChave = chaves.length === 0;
    if (!texto(v.tipo)) avisos.push("tipo vazio: se o equipamento for novo, entra como “Outro”.");
    if (semChave) {
      avisos.push("Sem nº de série nem patrimônio/TAG: reimportar esta linha cria outro equipamento.");
      const parecidos = ctx.mapas?.parecidos?.get(chaveParecido(clienteId!, unidadeId!, marca!, modelo!, cap.valor));
      if (parecidos) avisos.push(`Possível duplicado — já cadastrado nesta unidade: ${parecidos}.`);
    }
    return {
      ok: true, rotulo, chaves, avisos,
      dados: {
        clienteId, unidadeId, semChave, tipoRef: tipo.valor, marca, modelo, capacidade: cap.valor,
        fluido: normalizarFluido(texto(v.fluido)), tensao: normalizarTensao(texto(v.tensao)),
        localizacao: ambiente, setor: livre(v.setor), numeroSerie: serie, patrimonio, nome: livre(v.nome), observacoes: pLivre(texto(v.observacoes)),
      },
    };
  },
};

/* ───────── Fornecedores (dedup por id_sistema, CNPJ/CPF; sem nenhum dos dois, pelo nome) ───────── */
const fornecedores: DefImportacao = {
  entidade: "fornecedores", singular: "fornecedor", plural: "fornecedores", chaveDescricao: "id_sistema, CNPJ/CPF (ou nome, sem documento)",
  colunas: [
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome / razão social", exemplo: "Frigelar Distribuidora", apelidos: ["razao_social", "fornecedor"] },
    { chave: "cnpj_cpf", titulo: "cnpj_cpf", ajuda: "CNPJ ou CPF (chave para não duplicar; sem ele, vale o nome)", exemplo: "11.444.777/0001-61", apelidos: ["cnpj", "cpf", "cpf_cnpj", "documento"] },
    { chave: "telefone", titulo: "telefone", ajuda: "Telefone", exemplo: "(11) 3333-4444", apelidos: ["fone", "celular"] },
    { chave: "email", titulo: "email", ajuda: "E-mail", exemplo: "vendas@frigelar.com.br", apelidos: ["e_mail"] },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações", exemplo: "Gás e peças", apelidos: ["obs", "observacao"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("fornecedor")],
  exportar: (f) => ({
    nome: txt(f.nome), cnpj_cpf: f.documento ? formatarDocumento(String(f.documento)) : "", telefone: txt(f.telefone), email: txt(f.email),
    observacoes: txt(f.observacoes), id_sistema: txt(f.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const doc = lerDocumento(v.cnpj_cpf, erros, false);
    const email = texto(v.email);
    if (email && !EMAIL.test(email)) erros.push(`email: “${email}” não é um e-mail válido.`);
    // Sem id nem documento, o nome é a chave (como sempre foi)
    const chaves = [...(id ? [`id:${id}`] : []), ...(doc ? [`doc:${doc}`] : []), ...(!id && !doc ? [`nome:${chaveNome(rotulo)}`] : [])];
    return validarPeloCadastro(CADASTROS.fornecedores, {
      nome: rotulo || undefined, documento: doc, telefone: texto(v.telefone), email: email?.toLowerCase(), observacoes: texto(v.observacoes),
    }, erros, rotulo, chaves, ctx);
  },
};

/* ───────── Serviços e produtos (dedup por id_sistema, código; sem nenhum dos dois, pelo nome) ───────── */
/**
 * Código como chave: com ele (ou o id_sistema), editar o NOME na planilha atualiza o mesmo cadastro —
 * pelo nome, a linha viraria um cadastro novo. Sem código e sem id, vale o nome (como sempre foi).
 */
function chavesItem(id: string | undefined, cod: string | number | null | undefined, rotulo: string) {
  return [...(id ? [`id:${id}`] : []), ...(cod != null ? [`cod:${cod}`] : []), ...(!id && cod == null ? [`nome:${chaveNome(rotulo)}`] : [])];
}

const servicos: DefImportacao = {
  entidade: "servicos", singular: "serviço", plural: "serviços", chaveDescricao: "id_sistema, código (ou nome, sem código)",
  colunas: [
    { chave: "codigo", titulo: "codigo", ajuda: "Código do serviço (letras e números, ex.: LIMP01). Já existe = atualiza esse serviço; novo = cria com ele; vazio = gerado pelo nome.", exemplo: "", apelidos: ["cod", "codigo_servico_interno"] },
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome do serviço", exemplo: "Manutenção preventiva split", apelidos: ["servico", "descricao_do_servico"] },
    { chave: "descricao", titulo: "descricao", ajuda: "Descrição", exemplo: "Limpeza de filtros e serpentina" },
    { chave: "unidade", titulo: "unidade", ajuda: "Unidade de cobrança (vazio = un)", exemplo: "un", opcoes: UNIDADES_SERVICO.map((u) => u.rotulo), apelidos: ["un", "und"] },
    { chave: "valor_padrao", titulo: "valor_padrao", ajuda: "Valor em R$ (ex.: 250,00)", exemplo: "250,00", apelidos: ["valor", "preco", "preco_padrao"] },
    { chave: "codigo_municipal", titulo: "codigo_municipal", ajuda: "Código de tributação na prefeitura (NFS-e). Dado fiscal: exige a permissão Financeiro › Fiscal (NFS-e)", exemplo: "", apelidos: ["codigo_servico"] },
    { chave: "codigo_lc116", titulo: "codigo_lc116", ajuda: "Item da LC 116 (ex.: 14.01). Dado fiscal: exige a permissão Financeiro › Fiscal (NFS-e)", exemplo: "14.01", apelidos: ["lc116", "item_lc116"] },
    { chave: "aliquota_iss", titulo: "aliquota_iss", ajuda: "Alíquota de ISS em % (0 a 100). Dado fiscal: exige a permissão Financeiro › Fiscal (NFS-e)", exemplo: "5", apelidos: ["iss"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("serviço")],
  exportar: (s) => ({
    codigo: txt(s.codigo), nome: txt(s.nome), descricao: txt(s.descricao), unidade: rotuloDe(UNIDADES_SERVICO, s.unidade),
    valor_padrao: num(s.valorPadrao, 2), codigo_municipal: txt(s.codigoMunicipal), codigo_lc116: txt(s.codigoLc116),
    aliquota_iss: num(s.aliquotaISS), id_sistema: txt(s.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const cod = normalizarCodigoServico(texto(v.codigo));
    if (cod.erro) erros.push(`codigo: ${cod.erro}`);
    const un = opcao(v.unidade, UNIDADES_SERVICO, "unidade");
    if (un.erro) erros.push(un.erro);
    const valor = lerNumero(v.valor_padrao, "valor_padrao", erros);
    const iss = lerNumero(v.aliquota_iss, "aliquota_iss", erros);
    return validarPeloCadastro(CADASTROS.servicos, {
      codigo: cod.codigo ?? undefined, nome: rotulo || undefined, descricao: texto(v.descricao), unidade: un.valor, valorPadrao: valor,
      codigoMunicipal: texto(v.codigo_municipal), codigoLc116: texto(v.codigo_lc116), aliquotaISS: iss,
    }, erros, rotulo, chavesItem(id, cod.codigo, rotulo), ctx);
  },
};

/** "Orçamento E": o Uso do produto na planilha (Material | Peça), com os nomes que a gente encontra por aí */
export const OPCOES_USO_PRODUTO: OpcaoRef[] = [
  { valor: "MATERIAL", rotulo: "Material", aceitos: ["consumo", "material de consumo", "incluso", "incluso no servico", "insumo", "material de instalacao"] },
  { valor: "PECA", rotulo: "Peça", aceitos: ["peca", "pecas", "peca de reposicao", "venda a parte", "vendida a parte", "produto", "revenda"] },
];

const produtos: DefImportacao = {
  entidade: "produtos", singular: "produto", plural: "produtos", chaveDescricao: "id_sistema, código (ou nome, sem código)",
  colunas: [
    { chave: "codigo", titulo: "codigo", ajuda: "Código do produto (número). Vazio = produto novo, o sistema gera o código. Preenchido = atualiza o produto com esse código.", exemplo: "", apelidos: ["cod", "codigo_produto"] },
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome do produto", exemplo: "Gás R410A cilindro 11 kg", apelidos: ["produto"] },
    { chave: "descricao", titulo: "descricao", ajuda: "Descrição", exemplo: "Fluido refrigerante" },
    { chave: "unidade", titulo: "unidade", ajuda: "Unidade (vazio = un)", exemplo: "kg", opcoes: UNIDADES_PRODUTO.map((u) => u.rotulo), apelidos: ["un", "und"] },
    { chave: "valor_padrao", titulo: "valor_padrao", ajuda: "Valor em R$ (ex.: 1.250,00)", exemplo: "890,00", apelidos: ["valor", "preco", "preco_padrao"] },
    { chave: "estoque_minimo", titulo: "estoque_minimo", ajuda: "Estoque mínimo (número inteiro)", exemplo: "5", apelidos: ["estoque", "minimo"] },
    { chave: "uso", titulo: "uso", ajuda: "Material (vai dentro do serviço, sem valor para o cliente) ou Peça (vendida à parte). Vazio: produto novo vira Material; o que já existe não muda.", exemplo: "Material", opcoes: OPCOES_USO_PRODUTO.map((o) => o.rotulo), apelidos: ["tipo_uso", "uso_produto", "classificacao"] },
    COLUNA_ID,
  ],
  // O código do produto é sempre do sistema: informado e inexistente = erro (não inventa número)
  chavesQueExistem: [chaveIdQueExiste("produto"), {
    prefixo: "cod:", erro: (c) => `codigo: não há produto com o código ${c} nesta empresa. Para um produto novo, deixe o código vazio (o sistema gera).`,
  }],
  exportar: (p) => ({
    codigo: txt(p.codigo), nome: txt(p.nome), descricao: txt(p.descricao), unidade: rotuloDe(UNIDADES_PRODUTO, p.unidade),
    valor_padrao: num(p.valorPadrao, 2), estoque_minimo: num(p.estoqueMinimo), uso: rotuloDe(OPCOES_USO_PRODUTO, p.uso), id_sistema: txt(p.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const cod = normalizarCodigoProduto(texto(v.codigo));
    if (cod.erro) erros.push(`codigo: ${cod.erro}`);
    const un = opcao(v.unidade, UNIDADES_PRODUTO, "unidade");
    if (un.erro) erros.push(un.erro);
    const valor = lerNumero(v.valor_padrao, "valor_padrao", erros);
    const estoque = lerNumero(v.estoque_minimo, "estoque_minimo", erros, { inteiro: true });
    const uso = opcao(v.uso, OPCOES_USO_PRODUTO, "uso");
    if (uso.erro) erros.push(uso.erro);
    return validarPeloCadastro(CADASTROS.produtos, {
      nome: rotulo || undefined, descricao: texto(v.descricao), unidade: un.valor, valorPadrao: valor, estoqueMinimo: estoque, uso: uso.valor,
    }, erros, rotulo, chavesItem(id, cod.codigo, rotulo), ctx);
  },
};

/* ───────── Estoque inicial (o saldo de um produto JÁ cadastrado: código → id_sistema → nome) ───────── */
const fmtQtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
/** Ver custo (último custo de compra): a coluna de custo só existe para quem tem a permissão — e nunca para o papel TECNICO (usuarioVeCustoDeCompra). */
const veCusto = (permitido: (m: string, a: Acao) => boolean, papel?: string) => papel !== "TECNICO" && podeVerCustoDeCompra(permitido);

const estoque: DefImportacao = {
  entidade: "estoque", singular: "produto", plural: "saldos de estoque", chaveDescricao: "código, id_sistema ou nome do produto",
  baixar: "Baixar o estoque atual (para conferir e ajustar)",
  avisoPrevia: "Cada linha leva o saldo do produto à quantidade informada: lança só a diferença (subindo, uma entrada de inventário; descendo, um ajuste). O produto precisa estar cadastrado e controlar estoque.",
  colunas: [
    { chave: "codigo", titulo: "codigo", ajuda: "Código do produto no Frivo (o mais seguro para casar). Vazio = pelo nome.", exemplo: "12", apelidos: ["cod", "codigo_produto"] },
    // Nem código nem nome são obrigatórios sozinhos: a planilha de outro sistema pode trazer só um dos dois (a linha exige um)
    { chave: "produto", titulo: "produto", ajuda: "Nome do produto, como está cadastrado (obrigatório quando não há código)", exemplo: "Gás R410A cilindro 11 kg", apelidos: ["nome", "nome_produto", "descricao", "item"] },
    { chave: "quantidade", titulo: "quantidade", obrig: true, ajuda: "Saldo contado, na unidade do produto (ex.: 3 ou 2,5). É o saldo FINAL, não o que entra.", exemplo: "3", apelidos: ["saldo", "qtd", "qtde", "estoque", "quantidade_em_estoque", "saldo_atual"] },
    { chave: "custo_unitario", titulo: "custo_unitario", ajuda: "Opcional: custo de compra por unidade, em R$. Entra como o último custo do produto (alimenta custo e margem do orçamento).", exemplo: "389,90", apelidos: ["custo", "custo_unit", "preco_custo", "valor_custo", "custo_medio"], restrita: veCusto },
    COLUNA_ID,
  ],
  chavesQueExistem: [
    { prefixo: "id:", erro: (id) => `id_sistema “${id}” não é de nenhum produto desta empresa. Não altere essa coluna.` },
    { prefixo: "cod:", erro: (c) => `codigo: não há produto com o código ${c} nesta empresa. Confira o código ou deixe vazio para casar pelo nome.` },
    { prefixo: "nome:", erro: (n) => `produto “${n}” não está cadastrado. Importe a planilha de produtos antes (Configurações › Produtos).` },
  ],
  exportar: (p) => ({
    codigo: txt(p.codigo), produto: txt(p.nome), quantidade: num(p.saldo), custo_unitario: num(p.ultimoCusto), id_sistema: txt(p.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const avisos: string[] = [];
    const nome = texto(v.produto);
    const id = lerId(v.id_sistema, erros);
    const cod = normalizarCodigoProduto(texto(v.codigo));
    if (cod.erro) erros.push(`codigo: ${cod.erro}`);
    const rotulo = nome ?? (cod.codigo != null ? `código ${cod.codigo}` : "");
    if (!nome && cod.codigo == null && !id) erros.push("produto: informe o nome ou o código do produto.");
    const qtd = lerNumero(v.quantidade, "quantidade", erros);
    if (qtd === undefined && !erros.some((e) => e.startsWith("quantidade"))) erros.push("quantidade: obrigatória (o saldo contado; 0 se não há nenhum).");
    if (qtd !== undefined && qtd < 0) erros.push("quantidade: o saldo não pode ser negativo.");
    const custo = lerNumero(v.custo_unitario, "custo_unitario", erros);
    if (custo !== undefined && custo < 0) erros.push("custo_unitario: o custo não pode ser negativo.");
    if (custo !== undefined && !veCusto(ctx.permitido ?? (() => false))) erros.push("custo_unitario: exige a permissão de ver o custo dos produtos. Deixe a coluna vazia.");
    // Nome repetido em mais de um produto: não dá para saber qual (use o código)
    const kNome = nome ? `nome:${chaveNome(nome)}` : undefined;
    if (!id && cod.codigo == null && kNome && ctx.mapas?.ambiguas?.has(kNome))
      erros.push(`produto: há ${ctx.mapas.ambiguas.get(kNome)} produtos com o nome “${nome}”. Use o código do produto.`);
    const chaves = chavesItem(id, cod.codigo, nome ?? "");
    const produtoId = chaves.map((k) => ctx.existentes.get(k)).find(Boolean);
    // Pelo nome e não achou: a mensagem mostra o nome como a pessoa digitou (o motor só teria o normalizado)
    if (!produtoId && !id && cod.codigo == null && nome && !ctx.mapas?.ambiguas?.has(kNome!))
      erros.push(`produto “${nome}” não está cadastrado. Importe a planilha de produtos antes (Configurações › Produtos).`);
    if (produtoId && ctx.mapas?.semControle?.has(produtoId))
      erros.push("produto: este produto não controla estoque. Marque “Controla estoque” no cadastro dele antes.");
    if (produtoId && ctx.mapas?.inativos?.has(produtoId))
      erros.push("produto: este produto está inativo. Reative-o no cadastro antes de lançar o saldo.");
    if (erros.length) return { ok: false, erros, rotulo };
    const quantidade = arred(qtd!);
    if (produtoId) {
      const atual = Number(ctx.mapas?.saldos?.get(produtoId) ?? 0);
      if (quantidade === atual) avisos.push(`O saldo já é ${fmtQtd(atual)}: nada a lançar${custo !== undefined ? " (o custo só entra junto com uma entrada de quantidade)" : ""}.`);
      else if (quantidade < atual) avisos.push(`O saldo cai de ${fmtQtd(atual)} para ${fmtQtd(quantidade)} (ajuste de inventário)${custo !== undefined ? "; numa baixa o custo não entra" : ""}.`);
      else if (ctx.mapas?.comMovimento?.has(produtoId)) avisos.push(`Este produto já tem movimentações: entra só a diferença (+${fmtQtd(arred(quantidade - atual))}).`);
    }
    return { ok: true, rotulo, chaves, avisos, dados: { quantidade, custoUnitario: custo } };
  },
};

/* ───────── Colaboradores (id_sistema → CPF). Só o cadastro operacional: nunca salário, acesso ou dados bancários ───────── */
const OPCOES_FUNCAO: OpcaoRef[] = Object.entries(LABELS_FUNCAO).map(([valor, rotulo]) => ({
  valor, rotulo, aceitos: ({ TECNICO_CAMPO: ["tecnico", "técnico", "tecnico de refrigeracao", "campo"], RESPONSAVEL_TECNICO: ["rt", "responsavel"], ADMINISTRATIVO: ["adm", "escritorio"], MOTORISTA: [], OUTRO: [] } as Record<string, string[]>)[valor] ?? [],
}));
const OPCOES_TIPO_EQUIPE: OpcaoRef[] = [{ valor: "CAMPO", rotulo: "Campo", aceitos: ["externo"] }, { valor: "ADMINISTRATIVO", rotulo: "Administrativo", aceitos: ["interno", "escritorio", "adm"] }];
/** Mesma regra da importação da folha: técnico de campo e motorista são equipe de campo; o resto, administrativa. */
const equipeDaFuncao = (f: string) => (f === "TECNICO_CAMPO" || f === "MOTORISTA" ? "CAMPO" : "ADMINISTRATIVO");
const formatarCpf = (d: string) => d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
const minimoDigitos = (t: string, n: number) => t.replace(/\D/g, "").length >= n;

const colaboradores: DefImportacao = {
  entidade: "colaboradores", singular: "colaborador", plural: "colaboradores", chaveDescricao: "id_sistema ou CPF",
  baixar: "Baixar colaboradores já cadastrados (para editar em massa)",
  avisoPrevia: "Só o cadastro operacional. Salário, acesso ao app, perfil e dados bancários não entram por aqui (salário e benefícios: Financeiro › Custo de pessoal).",
  colunas: [
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome completo", exemplo: "Rafael Teixeira", apelidos: ["nome_completo", "colaborador", "funcionario", "tecnico"] },
    { chave: "cpf", titulo: "cpf", obrig: true, ajuda: "CPF, com ou sem pontuação (chave para não duplicar)", exemplo: "529.982.247-25", apelidos: ["documento", "cpf_colaborador", "n_cpf"] },
    { chave: "telefone", titulo: "telefone", ajuda: "Telefone ou celular (o app e o WhatsApp precisam dele; vazio entra com aviso)", exemplo: "(31) 98888-0101", apelidos: ["celular", "fone", "whatsapp", "telefone_celular"] },
    { chave: "email", titulo: "email", ajuda: "E-mail", exemplo: "rafael@empresa.com.br", apelidos: ["e_mail"] },
    { chave: "funcao", titulo: "funcao", ajuda: "Função no Frivo (vazio = Técnico de campo, ao cadastrar)", exemplo: "Técnico de campo", opcoes: Object.values(LABELS_FUNCAO), apelidos: ["tipo", "funcao_no_sistema"] },
    { chave: "equipe", titulo: "equipe", ajuda: "Campo ou Administrativo (vazio = pela função)", exemplo: "Campo", opcoes: OPCOES_TIPO_EQUIPE.map((o) => o.rotulo), apelidos: ["tipo_equipe", "lotacao"] },
    { chave: "cargo", titulo: "cargo", ajuda: "Cargo (Configurações › Cargos). Se não existir, é criado e aparece no resultado para revisar.", exemplo: "Técnico de refrigeração", apelidos: ["funcao_cargo", "cargo_funcao"] },
    { chave: "crea", titulo: "crea", ajuda: "CREA/CFT (responsável técnico)", exemplo: "", apelidos: ["cft", "registro_profissional"] },
    { chave: "endereco", titulo: "endereco", ajuda: "Rua / avenida", exemplo: "", apelidos: ["logradouro", "rua"] },
    { chave: "numero", titulo: "numero", ajuda: "Número", exemplo: "" },
    { chave: "complemento", titulo: "complemento", ajuda: "Complemento", exemplo: "" },
    { chave: "bairro", titulo: "bairro", ajuda: "Bairro", exemplo: "" },
    { chave: "cidade", titulo: "cidade", ajuda: "Cidade", exemplo: "Belo Horizonte", apelidos: ["municipio"] },
    { chave: "estado", titulo: "estado", ajuda: "UF (2 letras)", exemplo: "MG", apelidos: ["uf"] },
    { chave: "cep", titulo: "cep", ajuda: "CEP", exemplo: "" },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações", exemplo: "", apelidos: ["obs", "observacao"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("colaborador")],
  exportar: (t, refs) => ({
    nome: txt(t.nome), cpf: txt(t.cpf), telefone: txt(t.telefone), email: txt(t.email), funcao: LABELS_FUNCAO[t.tipo as string] ?? txt(t.tipo),
    equipe: rotuloDe(OPCOES_TIPO_EQUIPE, t.tipoEquipe), cargo: t.cargoId ? rotuloDe(refs.cargo ?? [], t.cargoId) : "", crea: txt(t.crea),
    endereco: txt(t.endereco), numero: txt(t.numero), complemento: txt(t.complemento), bairro: txt(t.bairro), cidade: txt(t.cidade),
    estado: txt(t.estado), cep: txt(t.cep), observacoes: txt(t.observacoes), id_sistema: txt(t.id),
  }),
  validar(v, ctx) {
    const erros: string[] = [];
    const nome = texto(v.nome);
    const rotulo = nome ?? "";
    if (!nome) erros.push("nome: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const cpfTxt = texto(v.cpf);
    const cpf = cpfTxt ? digitos(cpfTxt) : undefined;
    if (!cpfTxt) erros.push("cpf: obrigatório.");
    else if (cpf!.length !== 11) erros.push(`cpf: “${cpfTxt}” não tem 11 dígitos.`);
    const kCpf = cpf?.length === 11 ? `cpf:${cpf}` : undefined;
    const doCpf = kCpf ? ctx.existentes.get(kCpf) : undefined;
    const doId = id ? ctx.existentes.get(`id:${id}`) : undefined;
    // CPF que já está em 2 ou mais colaboradores (escrito de jeitos diferentes): sem o id_sistema, não dá
    // para saber qual; com ele, é o id que decide e o CPF não serve de chave
    const ambiguo = !!kCpf && !!ctx.mapas?.ambiguas?.has(kCpf);
    if (ambiguo && !id)
      erros.push(`cpf: “${cpfTxt}” está em ${ctx.mapas!.ambiguas!.get(kCpf!)} colaboradores desta empresa. Baixe a planilha de colaboradores e use o id_sistema.`);
    // CPF novo precisa ser válido (os dígitos verificadores); o que já está no cadastro casa como está
    if (kCpf && !doCpf && !ambiguo && !cpfValido(cpf!)) erros.push(`cpf: “${cpfTxt}” não é um CPF válido (confira os dígitos).`);
    // O CPF é a identidade do colaborador: não muda pela planilha
    if (doId && kCpf && !doCpf && !ambiguo) erros.push("cpf: diferente do CPF deste colaborador. O CPF não muda pela planilha — corrija na ficha do colaborador.");
    const novo = !doId && !doCpf;
    const avisos: string[] = [];
    const telefone = texto(v.telefone);
    if (telefone && !minimoDigitos(telefone, 8)) erros.push(`telefone: “${telefone}” está incompleto.`);
    // Sem telefone o colaborador entra (não trava a implantação), mas o app e o WhatsApp precisam dele
    else if (!telefone && novo) avisos.push("Sem telefone: o colaborador entra, mas o app e o WhatsApp precisam do telefone. Complete na ficha.");
    const email = texto(v.email);
    if (email && !EMAIL.test(email)) erros.push(`email: “${email}” não é um e-mail válido.`);
    const funcao = opcao(v.funcao, OPCOES_FUNCAO, "funcao");
    if (funcao.erro) erros.push(funcao.erro);
    const equipe = opcao(v.equipe, OPCOES_TIPO_EQUIPE, "equipe");
    if (equipe.erro) erros.push(equipe.erro);
    // Cargo: um ativo da empresa; o que não existe é CRIADO na gravação (como na planilha da folha) e listado no
    // resultado para o gestor revisar; o inativo não é recriado nem reativado
    const nomeCargo = livre(v.cargo);
    const cargo = opcao(v.cargo, ctx.refs.cargo ?? [], "cargo");
    let cargoNovo: string | undefined;
    if (cargo.erro && nomeCargo) {
      if (ctx.mapas?.cargosInativos?.has(chaveNome(nomeCargo))) erros.push(`cargo “${nomeCargo}” está inativo. Reative em Configurações › Cargos (ou use outro).`);
      else if (nomeCargo.length > 100) erros.push("cargo: no máximo 100 letras.");
      else { cargoNovo = nomeCargo; avisos.push(`cargo “${nomeCargo}” não existe: será criado em Configurações › Cargos.`); }
    }
    const uf = texto(v.estado)?.toUpperCase();
    if (uf && !UFS.includes(uf)) erros.push(`estado: “${texto(v.estado)}” não é uma UF.`);
    if (erros.length) return { ok: false, erros, rotulo };
    const chaves = [...(id ? [`id:${id}`] : []), ...(kCpf && !ambiguo ? [kCpf] : [])];
    return {
      ok: true, rotulo, chaves, avisos,
      dados: {
        nome: pNome(nome), cpf: formatarCpf(cpf!), telefone, email: email ? padronizarEmail(email) : undefined,
        tipo: funcao.valor ?? (novo ? "TECNICO_CAMPO" : undefined),
        tipoEquipe: equipe.valor ?? (novo ? equipeDaFuncao(funcao.valor ?? "TECNICO_CAMPO") : undefined),
        cargoId: cargo.valor, cargoNovo, crea: livre(v.crea),
        endereco: pNome(texto(v.endereco)), numero: texto(v.numero), complemento: livre(v.complemento), bairro: pNome(texto(v.bairro)),
        cidade: pNome(texto(v.cidade)), estado: uf, cep: texto(v.cep), observacoes: pLivre(texto(v.observacoes)),
      },
    };
  },
};

/* ───────── Veículos (id_sistema → placa) ───────── */
const OPCOES_TIPO_VEICULO: OpcaoRef[] = [
  { valor: "CARRO", rotulo: "Carro", aceitos: ["automovel", "passeio", "utilitario"] }, { valor: "VAN", rotulo: "Van", aceitos: ["furgao", "furgão"] },
  { valor: "MOTO", rotulo: "Moto", aceitos: ["motocicleta"] }, { valor: "CAMINHAO", rotulo: "Caminhão", aceitos: ["caminhonete"] }, { valor: "OUTRO", rotulo: "Outro" },
];
/** Placa sem espaço, hífen ou ponto, em maiúsculas: "frv-9a11" = "FRV9A11" */
export const chavePlaca = (t: string) => t.replace(/[\s\-.]+/g, "").toUpperCase();
/** Antiga (ABC1234) ou Mercosul (ABC1D23) */
export const placaValida = (p: string) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p);
const anoMaximo = () => new Date().getFullYear() + 1;
function lerAno(v: Celula, campo: string, erros: string[]) {
  const t = texto(v);
  if (!t) return undefined;
  const n = Number(t);
  if (!/^\d{4}$/.test(t) || n < 1950 || n > anoMaximo()) { erros.push(`${campo}: “${t}” não é um ano (ex.: 2022).`); return undefined; }
  return t;
}

const veiculos: DefImportacao = {
  entidade: "veiculos", singular: "veículo", plural: "veículos", chaveDescricao: "id_sistema ou placa",
  baixar: "Baixar veículos já cadastrados (para editar em massa)",
  colunas: [
    { chave: "placa", titulo: "placa", obrig: true, ajuda: "Placa antiga (ABC-1234) ou Mercosul (ABC1D23) — chave para não duplicar", exemplo: "FRV1A23", apelidos: ["placa_veiculo"] },
    { chave: "modelo", titulo: "modelo", obrig: true, ajuda: "Modelo", exemplo: "Fiorino", apelidos: ["veiculo", "descricao"] },
    { chave: "marca", titulo: "marca", ajuda: "Marca", exemplo: "Fiat", apelidos: ["fabricante", "montadora"] },
    { chave: "ano", titulo: "ano", ajuda: "Ano de fabricação", exemplo: "2022", apelidos: ["ano_fabricacao", "ano_fab"] },
    { chave: "ano_modelo", titulo: "ano_modelo", ajuda: "Ano do modelo", exemplo: "2023", apelidos: ["ano_mod"] },
    { chave: "tipo", titulo: "tipo", ajuda: "Carro, Van, Moto, Caminhão ou Outro (vazio = Carro, ao cadastrar)", exemplo: "Van", opcoes: OPCOES_TIPO_VEICULO.map((o) => o.rotulo), apelidos: ["tipo_veiculo", "categoria"] },
    { chave: "combustivel", titulo: "combustivel", ajuda: "Combustível", exemplo: "Flex", apelidos: ["combustível"] },
    { chave: "cor", titulo: "cor", ajuda: "Cor", exemplo: "Branca" },
    { chave: "chassi", titulo: "chassi", ajuda: "Chassi", exemplo: "" },
    { chave: "renavam", titulo: "renavam", ajuda: "Renavam", exemplo: "" },
    { chave: "quilometragem", titulo: "quilometragem", ajuda: "Quilometragem atual (número inteiro)", exemplo: "45300", apelidos: ["km", "km_atual", "hodometro", "odometro", "quilometragem_atual"] },
    { chave: "responsavel_cpf", titulo: "responsavel_cpf", ajuda: "CPF do colaborador responsável (já cadastrado)", exemplo: "", apelidos: ["cpf_responsavel", "responsavel", "motorista_cpf", "cpf_motorista"] },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações", exemplo: "", apelidos: ["obs", "observacao"] },
    COLUNA_ID,
  ],
  chavesQueExistem: [chaveIdQueExiste("veículo")],
  exportar: (x) => {
    const r = x.responsavel as { cpf?: string } | null | undefined;
    return {
      placa: txt(x.placa), modelo: txt(x.modelo), marca: txt(x.marca), ano: txt(x.ano), ano_modelo: txt(x.anoModelo),
      tipo: rotuloDe(OPCOES_TIPO_VEICULO, x.tipo), combustivel: txt(x.combustivel), cor: txt(x.cor), chassi: txt(x.chassi), renavam: txt(x.renavam),
      quilometragem: num(x.quilometragemAtual), responsavel_cpf: txt(r?.cpf), observacoes: txt(x.observacoes), id_sistema: txt(x.id),
    };
  },
  validar(v, ctx) {
    const erros: string[] = [];
    const placaTxt = texto(v.placa);
    const placa = placaTxt ? chavePlaca(placaTxt) : undefined;
    const modelo = livre(v.modelo);
    const rotulo = [placa, modelo].filter(Boolean).join(" — ");
    if (!placaTxt) erros.push("placa: obrigatória.");
    else if (!placaValida(placa!)) erros.push(`placa: “${placaTxt}” não é uma placa (ex.: ABC-1234 ou ABC1D23).`);
    if (!modelo) erros.push("modelo: obrigatório.");
    const id = lerId(v.id_sistema, erros);
    const kPlaca = placa && placaValida(placa) ? `placa:${placa}` : undefined;
    const doPlaca = kPlaca ? ctx.existentes.get(kPlaca) : undefined;
    const doId = id ? ctx.existentes.get(`id:${id}`) : undefined;
    const placaAmbigua = !!kPlaca && !!ctx.mapas?.ambiguas?.has(kPlaca);
    if (placaAmbigua && !id)
      erros.push(`placa: “${placaTxt}” está em ${ctx.mapas!.ambiguas!.get(kPlaca!)} veículos desta empresa (escrita de jeitos diferentes). Use o id_sistema.`);
    if (doId && kPlaca && !doPlaca && !placaAmbigua) erros.push("placa: diferente da placa deste veículo. A placa não muda pela planilha — corrija na ficha do veículo.");
    const ano = lerAno(v.ano, "ano", erros);
    const anoModelo = lerAno(v.ano_modelo, "ano_modelo", erros);
    const tipo = opcao(v.tipo, OPCOES_TIPO_VEICULO, "tipo");
    if (tipo.erro) erros.push(tipo.erro);
    const km = lerNumero(v.quilometragem, "quilometragem", erros, { inteiro: true });
    if (km !== undefined && km < 0) erros.push("quilometragem: não pode ser negativa.");
    const combustivel = livre(v.combustivel);
    if (combustivel && combustivel.length > 30) erros.push("combustivel: no máximo 30 letras.");
    // Responsável: um colaborador DESTA empresa, pelo CPF
    const respTxt = texto(v.responsavel_cpf);
    let responsavelId: string | undefined;
    if (respTxt) {
      const d = digitos(respTxt);
      const k = `cpf:${d}`;
      if (d.length !== 11) erros.push(`responsavel_cpf: “${respTxt}” não tem 11 dígitos.`);
      else if (ctx.mapas?.colaboradoresAmbiguos?.has(k)) erros.push(`responsavel_cpf: “${respTxt}” está em mais de um colaborador. Corrija o cadastro dos colaboradores.`);
      else if (!(responsavelId = ctx.mapas?.colaboradores?.get(k))) erros.push(`responsavel_cpf: nenhum colaborador com o CPF ${respTxt} nesta empresa. Importe os colaboradores antes.`);
    }
    if (erros.length) return { ok: false, erros, rotulo };
    const novo = !doId && !doPlaca;
    return {
      ok: true, rotulo, chaves: [...(id ? [`id:${id}`] : []), ...(placaAmbigua ? [] : [kPlaca!])],
      dados: {
        placa, modelo, marca: livre(v.marca), ano, anoModelo, tipo: tipo.valor ?? (novo ? "CARRO" : undefined), combustivel, cor: livre(v.cor),
        chassi: texto(v.chassi)?.toUpperCase(), renavam: texto(v.renavam), quilometragemAtual: km, responsavelId, observacoes: pLivre(texto(v.observacoes)),
      },
    };
  },
};


/* ───────── Datas (contratos e PMOC) ───────── */
const doisDig = (n: number) => String(n).padStart(2, "0");
/** Data de calendário válida (sem virar o mês: 31/02 é erro) → "AAAA-MM-DD" */
function dataValida(a: number, m: number, d: number): string | undefined {
  if (a < 1990 || a > 2100 || m < 1 || m > 12 || d < 1) return undefined;
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${a}-${doisDig(m)}-${doisDig(d)}` : undefined;
}
/**
 * Data da planilha: "dd/mm/aaaa" (ou com "-" e "."), "aaaa-mm-dd" ou o número de série do Excel.
 * Vazio = não informado; o que não é data = erro (nunca vira "hoje").
 */
export function lerData(v: Celula, campo: string, erros: string[]): string | undefined {
  if (v === null || v === undefined || String(v).trim() === "") return undefined;
  if (typeof v === "number" || /^\d{5}$/.test(String(v).trim())) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 30000 && n < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return dataValida(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }
  const t = String(v).trim();
  let r: string | undefined;
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  if (br) r = dataValida(+br[3], +br[2], +br[1]);
  else if (iso) r = dataValida(+iso[1], +iso[2], +iso[3]);
  if (!r) erros.push(`${campo}: “${t}” não é uma data (use dd/mm/aaaa).`);
  return r;
}
/** Soma meses a "AAAA-MM-DD" (fim de mês ajustado: 31/01 + 1 mês = 28 ou 29/02) */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return `${alvo.getUTCFullYear()}-${doisDig(alvo.getUTCMonth() + 1)}-${doisDig(Math.min(d, ultimo))}`;
}
/** Lista "a; b; c" (também com "," ou quebra de linha) → itens sem repetir */
const lista = (v: Celula) => [...new Set((texto(v) ?? "").split(/[;\n,]+/).map((x) => x.trim()).filter(Boolean))];

/* ───────── Contratos ───────── */
/**
 * Contratos (Implantação, leva 6). A planilha SÓ CADASTRA contrato novo: alterar um contrato mexe na cobrança,
 * e isso é feito pela tela. Tudo que move dinheiro ou agenda nasce DESLIGADO (faturamento automático, aprovação
 * automática, NFS-e, boleto, recorrência de OS, renovação automática, reajuste) e o contrato "ativo" da planilha
 * entra SUSPENSO — só contrato ATIVO gera previsão de contas a receber, entra nas medições do mês e gera OS
 * (regra CO2). Quem revisa ativa pela tela, e só então a cobrança começa.
 */
export const OPCOES_TIPO_CONTRATO: OpcaoRef[] = Object.entries(LABELS_TIPO_CONTRATO).map(([valor, rotulo]) => ({
  valor, rotulo,
  aceitos: ({
    MANUTENCAO_PREVENTIVA: ["preventiva", "pmoc", "manutencao preventiva"], MANUTENCAO_CORRETIVA: ["corretiva"],
    MANUTENCAO_COMPLETA: ["completa", "preventiva e corretiva", "manutencao"], INSTALACAO: ["instalacao"], LOCACAO: ["locacao", "aluguel"],
    ASSISTENCIA_TECNICA: ["assistencia", "assistencia tecnica"],
  } as Record<string, string[]>)[valor] ?? [],
}));
/** Situação na planilha: ativo (entra Suspenso até a revisão), encerrado ou cancelado (histórico) */
export const OPCOES_SITUACAO_CONTRATO: OpcaoRef[] = [
  { valor: "ATIVO", rotulo: "Ativo", aceitos: ["vigente", "em vigor", "ativo"] },
  { valor: "ENCERRADO", rotulo: "Encerrado", aceitos: ["finalizado", "concluido", "vencido", "encerrado"] },
  { valor: "CANCELADO", rotulo: "Cancelado", aceitos: ["rescindido", "cancelado"] },
];
export const OPCOES_PERIODICIDADE: OpcaoRef[] = opcoesDeLabels(LABELS_PERIODICIDADE);
/** O status que o contrato GRAVA: o "ativo" da planilha entra Suspenso até alguém revisar */
export const statusImportado = (situacao: string) => (situacao === "ATIVO" ? "SUSPENSO" : situacao);
export const AVISO_CONTRATO_SUSPENSO =
  "Contrato ativo entra SUSPENSO, com faturamento automático, NFS-e, boleto, recorrência de OS, renovação automática e reajuste DESLIGADOS. " +
  "Nada é cobrado nem agendado até alguém revisar o contrato e ativá-lo pela tela.";
const chaveNumeroContrato = (t: string) => `num:${t.trim().toUpperCase()}`;

const contratos: DefImportacao = {
  entidade: "contratos", singular: "contrato", plural: "contratos", chaveDescricao: "número do contrato",
  soCadastra: "A planilha só cadastra contratos novos: um contrato que já existe (mesmo número) vira erro na prévia. Para alterar um contrato, use a tela dele.",
  avisoPrevia: `${AVISO_CONTRATO_SUSPENSO} A planilha só cadastra contratos novos: para alterar um contrato que já existe, use a tela.`,
  colunas: [
    { chave: "numero", titulo: "numero", ajuda: "Número do contrato (vazio = o próximo da numeração da empresa)", exemplo: "CT-2026-001", apelidos: ["numero_contrato", "contrato", "n_contrato", "nº_contrato"] },
    { chave: "cnpj_cpf", titulo: "cnpj_cpf", obrig: true, ajuda: "CNPJ/CPF do cliente (já cadastrado)", exemplo: "11.222.333/0001-81", apelidos: ["cnpj", "cpf", "documento", "cliente_cnpj", "cnpj_cliente"] },
    { chave: "tipo", titulo: "tipo", obrig: true, ajuda: "Manutenção Preventiva, Corretiva, Completa, Instalação, Locação ou Assistência Técnica", exemplo: "Manutenção Preventiva", opcoes: OPCOES_TIPO_CONTRATO.map((o) => o.rotulo), apelidos: ["tipo_contrato", "modalidade"] },
    { chave: "situacao", titulo: "situacao", ajuda: "Ativo (entra Suspenso até a revisão), Encerrado ou Cancelado. Vazio = Ativo", exemplo: "Ativo", opcoes: OPCOES_SITUACAO_CONTRATO.map((o) => o.rotulo), apelidos: ["status", "situação"] },
    { chave: "data_inicio", titulo: "data_inicio", obrig: true, ajuda: "Início da vigência (dd/mm/aaaa)", exemplo: "01/02/2026", apelidos: ["inicio", "data_de_inicio", "vigencia_inicio", "início"] },
    { chave: "data_fim", titulo: "data_fim", ajuda: "Fim da vigência (dd/mm/aaaa). Vazio = sem data de fim", exemplo: "31/01/2027", apelidos: ["fim", "termino", "data_termino", "vigencia_fim", "vencimento_contrato"] },
    { chave: "valor_mensal", titulo: "valor_mensal", ajuda: "Valor mensal (fica gravado; a cobrança só começa quando o contrato for ativado)", exemplo: "1.250,00", apelidos: ["valor", "mensalidade", "valor_contrato"] },
    { chave: "periodicidade", titulo: "periodicidade", ajuda: "Mensal, Bimestral, Trimestral, Semestral, Anual… Vazio = Mensal", exemplo: "Mensal", opcoes: OPCOES_PERIODICIDADE.map((o) => o.rotulo), apelidos: ["periodicidade_cobranca", "frequencia_cobranca"] },
    { chave: "dia_vencimento", titulo: "dia_vencimento", ajuda: "Dia do vencimento da mensalidade (1 a 31)", exemplo: "10", apelidos: ["vencimento", "dia_pagamento"] },
    { chave: "unidades", titulo: "unidades", ajuda: "Unidades do cliente cobertas, separadas por ; (vazio = a unidade Principal)", exemplo: "Principal", apelidos: ["locais", "unidade", "local"] },
    { chave: "descricao_servicos", titulo: "descricao_servicos", ajuda: "O que o contrato cobre", exemplo: "Manutenção preventiva mensal dos aparelhos", apelidos: ["escopo", "servicos", "descricao"] },
    { chave: "art_numero", titulo: "art_numero", ajuda: "Número da ART do contrato", exemplo: "", apelidos: ["art"] },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações", exemplo: "", apelidos: ["obs", "observacao"] },
  ],
  exportar: () => ({}),
  validar(v, ctx) {
    const erros: string[] = [];
    const numeroTxt = texto(v.numero);
    const doc = lerDocumento(v.cnpj_cpf, erros, true);
    const clienteId = doc ? ctx.mapas?.clientes?.get(doc) : undefined;
    const rotulo = [numeroTxt ?? "(número automático)", doc ? formatarDocumento(doc) : texto(v.cnpj_cpf)].filter(Boolean).join(" — ");
    if (doc && !clienteId) erros.push(`cnpj_cpf: nenhum cliente com o documento ${formatarDocumento(doc)} nesta empresa. Importe os clientes antes.`);
    if (numeroTxt && numeroTxt.length > 40) erros.push("numero: no máximo 40 caracteres.");
    else if (numeroTxt && ctx.existentes.has(chaveNumeroContrato(numeroTxt)))
      erros.push(`numero: o contrato ${numeroTxt} já existe. A planilha só cadastra contratos novos — para alterar, use a tela do contrato.`);
    const tipo = opcao(v.tipo, OPCOES_TIPO_CONTRATO, "tipo");
    if (tipo.erro) erros.push(tipo.erro);
    else if (!tipo.valor) erros.push("tipo: obrigatório.");
    const situacao = opcao(v.situacao, OPCOES_SITUACAO_CONTRATO, "situacao");
    if (situacao.erro) erros.push(situacao.erro);
    const inicio = lerData(v.data_inicio, "data_inicio", erros);
    if (!texto(v.data_inicio)) erros.push("data_inicio: obrigatória.");
    const fim = lerData(v.data_fim, "data_fim", erros);
    if (inicio && fim && fim < inicio) erros.push("data_fim: antes da data de início.");
    const valor = lerNumero(v.valor_mensal, "valor_mensal", erros);
    if (valor !== undefined && valor < 0) erros.push("valor_mensal: não pode ser negativo.");
    const periodicidade = opcao(v.periodicidade, OPCOES_PERIODICIDADE, "periodicidade");
    if (periodicidade.erro) erros.push(periodicidade.erro);
    const dia = lerNumero(v.dia_vencimento, "dia_vencimento", erros, { inteiro: true });
    if (dia !== undefined && (dia < 1 || dia > 31)) erros.push("dia_vencimento: de 1 a 31.");
    // Unidades do cliente, pelo nome; vazio = a Principal (se o cliente tiver)
    const nomes = lista(v.unidades);
    const unidadeIds: string[] = [];
    if (clienteId) {
      for (const n of nomes) {
        const u = ctx.mapas?.unidades?.get(`${clienteId}|${chaveNome(n)}`);
        if (u) { if (!unidadeIds.includes(u)) unidadeIds.push(u); } else erros.push(`unidades: “${n}” não é uma unidade ativa deste cliente.`);
      }
      if (!nomes.length) { const pr = ctx.mapas?.unidades?.get(`${clienteId}|*principal`); if (pr) unidadeIds.push(pr); }
    }
    const descricao = livre(v.descricao_servicos);
    if (descricao && descricao.length > 2000) erros.push("descricao_servicos: no máximo 2000 caracteres.");
    if (erros.length) return { ok: false, erros, rotulo };
    return {
      ok: true, rotulo, chaves: numeroTxt ? [chaveNumeroContrato(numeroTxt)] : [],
      dados: {
        numero: numeroTxt, clienteId, tipo: tipo.valor, situacao: situacao.valor ?? "ATIVO", dataInicio: inicio, dataFim: fim,
        valorMensal: valor, periodicidade: periodicidade.valor ?? "MENSAL", diaVencimento: dia, unidadeIds,
        descricaoServicos: descricao, artNumero: texto(v.art_numero), observacoes: pLivre(texto(v.observacoes)),
      },
    };
  },
};

/* ───────── PMOC ───────── */
/**
 * Planos PMOC (Implantação, leva 6). Cada linha cria um plano em RASCUNHO — rascunho não gera cronograma, OS
 * nem aviso ao cliente; quem revisa publica pela tela. Só cadastra (o mesmo nome na mesma unidade é erro).
 */
const pmocs: DefImportacao = {
  entidade: "pmocs", singular: "plano PMOC", plural: "planos PMOC", chaveDescricao: "nome do plano na unidade",
  soCadastra: "A planilha só cadastra planos novos: o mesmo nome na mesma unidade vira erro na prévia. Para alterar um plano, use a tela do PMOC.",
  avisoPrevia: "Cada plano entra como RASCUNHO: não gera cronograma, OS nem aviso ao cliente até alguém revisar e publicar pela tela.",
  colunas: [
    { chave: "cnpj_cpf", titulo: "cnpj_cpf", obrig: true, ajuda: "CNPJ/CPF do cliente (já cadastrado)", exemplo: "11.222.333/0001-81", apelidos: ["cnpj", "cpf", "documento", "cliente_cnpj"] },
    { chave: "unidade", titulo: "unidade", ajuda: "Unidade do cliente (vazio = a Principal)", exemplo: "Principal", apelidos: ["local", "unidade_nome"] },
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome do plano", exemplo: "PMOC 2026 — Sede", apelidos: ["plano", "nome_plano", "pmoc"] },
    { chave: "data_inicio", titulo: "data_inicio", obrig: true, ajuda: "Início (dd/mm/aaaa)", exemplo: "01/02/2026", apelidos: ["inicio", "início"] },
    { chave: "data_expiracao", titulo: "data_expiracao", ajuda: "Validade (dd/mm/aaaa). Vazio = 12 meses depois do início", exemplo: "31/01/2027", apelidos: ["validade", "vencimento", "data_fim", "fim"] },
    { chave: "equipamentos", titulo: "equipamentos", ajuda: "Números de série dos equipamentos do cliente, separados por ;", exemplo: "SN-001; SN-002", apelidos: ["series", "numeros_serie", "equipamentos_serie"] },
    { chave: "rt_nome", titulo: "rt_nome", ajuda: "Responsável técnico (nome)", exemplo: "", apelidos: ["responsavel_tecnico", "rt"] },
    { chave: "rt_crea", titulo: "rt_crea", ajuda: "CREA/CFT do responsável técnico", exemplo: "", apelidos: ["crea", "registro_rt"] },
    { chave: "art_numero", titulo: "art_numero", ajuda: "Número da ART", exemplo: "", apelidos: ["art"] },
    { chave: "descricao", titulo: "descricao", ajuda: "Descrição do plano", exemplo: "", apelidos: ["observacoes", "obs"] },
  ],
  exportar: () => ({}),
  validar(v, ctx) {
    const erros: string[] = [];
    const doc = lerDocumento(v.cnpj_cpf, erros, true);
    const clienteId = doc ? ctx.mapas?.clientes?.get(doc) : undefined;
    const nome = livre(v.nome);
    const rotulo = [nome, doc ? formatarDocumento(doc) : texto(v.cnpj_cpf)].filter(Boolean).join(" — ");
    if (doc && !clienteId) erros.push(`cnpj_cpf: nenhum cliente com o documento ${formatarDocumento(doc)} nesta empresa. Importe os clientes antes.`);
    if (!nome) erros.push("nome: obrigatório.");
    else if (nome.length > 200) erros.push("nome: no máximo 200 caracteres.");
    const unidadeTxt = livre(v.unidade);
    let unidadeId: string | undefined;
    if (clienteId) {
      unidadeId = ctx.mapas?.unidades?.get(unidadeTxt ? `${clienteId}|${chaveNome(unidadeTxt)}` : `${clienteId}|*principal`);
      if (!unidadeId) erros.push(unidadeTxt ? `unidade: “${unidadeTxt}” não é uma unidade ativa deste cliente.` : "unidade: o cliente não tem unidade Principal; informe a unidade.");
    }
    if (unidadeId && nome && ctx.existentes.has(`pmoc:${unidadeId}|${chaveNome(nome)}`))
      erros.push(`nome: já existe um plano “${nome}” nesta unidade. A planilha só cadastra planos novos — para alterar, use a tela do PMOC.`);
    const inicio = lerData(v.data_inicio, "data_inicio", erros);
    if (!texto(v.data_inicio)) erros.push("data_inicio: obrigatória.");
    const expiracaoInformada = lerData(v.data_expiracao, "data_expiracao", erros);
    const expiracao = expiracaoInformada ?? (inicio ? somarMeses(inicio, 12) : undefined);
    if (inicio && expiracaoInformada && expiracaoInformada <= inicio) erros.push("data_expiracao: precisa ser depois da data de início.");
    // Equipamentos pelo nº de série, do MESMO cliente e ativos (a regra da tela do PMOC)
    const equipamentoIds: string[] = [];
    if (clienteId) {
      for (const sn of lista(v.equipamentos)) {
        const k = `serie:${chaveCodigo(sn)}`;
        const id = ctx.mapas?.series?.get(`${clienteId}|${k}`);
        if (ctx.mapas?.seriesAmbiguas?.has(`${clienteId}|${k}`)) erros.push(`equipamentos: a série “${sn}” está em mais de um equipamento deste cliente. Vincule pela tela do PMOC.`);
        else if (!id) erros.push(`equipamentos: nenhum equipamento ativo deste cliente com a série “${sn}”.`);
        else if (!equipamentoIds.includes(id)) equipamentoIds.push(id);
      }
    }
    for (const [c, max] of [["rt_nome", 200], ["rt_crea", 50], ["art_numero", 50]] as const)
      if ((texto(v[c]) ?? "").length > max) erros.push(`${c}: no máximo ${max} caracteres.`);
    if (erros.length) return { ok: false, erros, rotulo };
    return {
      ok: true, rotulo, chaves: [],
      avisos: equipamentoIds.length ? undefined : ["Sem equipamentos: vincule-os na tela do PMOC antes de publicar."],
      dados: {
        clienteId, unidadeId, nome, dataInicio: inicio, dataExpiracao: expiracao, equipamentoIds,
        rtNome: livre(v.rt_nome), rtCrea: texto(v.rt_crea), artNumero: texto(v.art_numero), descricao: pLivre(texto(v.descricao)),
      },
    };
  },
  conferirPlanilha(linhas) {
    const vistos = new Map<string, number>();
    const r = new Map<number, string>();
    for (const l of linhas) {
      if (l.status === "erro" || !l.dados?.unidadeId) continue;
      const k = `${l.dados.unidadeId}|${chaveNome(String(l.dados.nome))}`;
      if (vistos.has(k)) r.set(l.linha, `nome: o mesmo plano na mesma unidade já está na linha ${vistos.get(k)}.`);
      else vistos.set(k, l.linha);
    }
    return r;
  },
};

export const IMPORTACOES: Record<EntidadeImportacao, DefImportacao> = { clientes, unidades, contatos, equipamentos, fornecedores, servicos, produtos, estoque, colaboradores, veiculos, contratos, pmocs };

/**
 * Baixar a planilha (exportar): ver o módulo da lista (tela e servidor usam esta tabela). Produtos e
 * serviços moram em Configurações; fornecedores, no Financeiro (ou Configurações); clientes, em Clientes.
 */
export const PERMISSOES_EXPORTACAO: Record<EntidadeImportacao, Requisito> = {
  clientes: [["clientes", "visualizar"]],
  unidades: [["clientes", "visualizar"]],
  contatos: [["clientes", "visualizar"]],
  equipamentos: [["equipamentos", "visualizar"]],
  fornecedores: [["financeiro", "visualizar"], ["configuracoes", "visualizar"]],
  servicos: [["configuracoes", "visualizar"]],
  produtos: [["configuracoes", "visualizar"]],
  estoque: [["estoque", "visualizar"]],
  // Dados pessoais (CPF, telefone, endereço) saindo do sistema: só quem gerencia a equipe
  colaboradores: [["equipes", "gerenciar"]],
  veiculos: [["veiculos", "visualizar"]],
  // Contratos e PMOC: a planilha só cadastra (não há "baixar os cadastrados")
  contratos: [["contratos", "visualizar"]],
  pmocs: [["pmoc", "visualizar"]],
};

/**
 * Criar = importar; editar = poder ATUALIZAR os duplicados. Mesmas permissões das telas. Aqui (puro), para
 * a tela de Implantação mostrar só os atalhos que a pessoa pode usar; o servidor usa a MESMA tabela.
 */
export const PERMISSOES_IMPORTACAO: Record<EntidadeImportacao, { criar: Requisito; editar: Requisito }> = {
  clientes: { criar: [["clientes", "criar"]], editar: [["clientes", "editar"]] },
  unidades: { criar: REQUISITO_FAMILIA.unidades!, editar: REQUISITO_FAMILIA.unidades! },
  contatos: { criar: REQUISITO_FAMILIA.contatos!, editar: REQUISITO_FAMILIA.contatos! },
  equipamentos: { criar: [["equipamentos", "criar"]], editar: [["equipamentos", "editar"]] },
  fornecedores: { criar: CADASTROS.fornecedores.permissoes.criar, editar: CADASTROS.fornecedores.permissoes.editar },
  servicos: { criar: CADASTROS.servicos.permissoes.criar, editar: CADASTROS.servicos.permissoes.editar },
  produtos: { criar: CADASTROS.produtos.permissoes.criar, editar: CADASTROS.produtos.permissoes.editar },
  // Estoque: toda linha ajusta o saldo de um produto que já existe — lançar estoque é "gerenciar"
  estoque: { criar: [["estoque", "gerenciar"]], editar: [["estoque", "gerenciar"]] },
  colaboradores: { criar: [["equipes", "gerenciar"]], editar: [["equipes", "gerenciar"]] },
  veiculos: { criar: [["veiculos", "gerenciar"]], editar: [["veiculos", "gerenciar"]] },
  // Só cadastram: "editar" = a mesma permissão (nunca há linha para atualizar)
  contratos: { criar: [["contratos", "criar"]], editar: [["contratos", "criar"]] },
  pmocs: { criar: [["pmoc", "criar"]], editar: [["pmoc", "criar"]] },
};

/**
 * O modelo DESTA pessoa: as colunas restritas (ex.: custo, para quem não vê custo) somem do modelo, da
 * exportação, do ligar colunas e da leitura — a planilha nem lê a coluna de quem não pode.
 */
export function defPara(entidade: EntidadeImportacao, permitido: (m: string, a: Acao) => boolean, papel?: string): DefImportacao {
  const def = IMPORTACOES[entidade];
  if (!def.colunas.some((c) => c.restrita)) return def;
  return { ...def, colunas: def.colunas.filter((c) => !c.restrita || c.restrita(permitido, papel)) };
}
export type { ContextoImportacao };
