/**
 * Importação por planilha — configuração de cada cadastro (colunas, dedup, validação). Puro.
 * Produtos, serviços e fornecedores validam pelos MESMOS schemas do cadastro padronizado
 * (lib/cadastros/registro.ts): o que a tela recusa, a planilha também recusa.
 */
import type { Celula } from "@/lib/folha/planilha";
import { CADASTROS, mensagemValidacao, type DefCadastro } from "@/lib/cadastros/registro";
import { digitos, formatarDocumento, tipoDocumento } from "@/lib/documento";
import { LABELS_ORIGEM, LABELS_SEGMENTO } from "@/lib/utils";
import { chaveNome, numero, opcao, texto, type ContextoImportacao, type DefImportacao, type OpcaoRef, type ResultadoLinha } from "@/lib/importacao/motor";

export const ENTIDADES_IMPORTACAO = ["clientes", "fornecedores", "servicos", "produtos"] as const;
export type EntidadeImportacao = (typeof ENTIDADES_IMPORTACAO)[number];
export const ehEntidadeImportacao = (v: string): v is EntidadeImportacao => (ENTIDADES_IMPORTACAO as readonly string[]).includes(v);

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
function validarPeloCadastro(def: DefCadastro, dados: Record<string, unknown>, erros: string[], rotulo: string, chaves: string[]): ResultadoLinha {
  const informados = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
  const r = def.schemaEditar.safeParse(informados);
  if (!r.success) erros.push(mensagemValidacao(r.error, def));
  return erros.length ? { ok: false, erros, rotulo } : { ok: true, dados: r.success ? r.data : informados, chaves, rotulo };
}

/** Documento opcional/obrigatório: só dígitos e com dígitos verificadores válidos. */
function lerDocumento(v: Celula, erros: string[], obrig: boolean) {
  const t = texto(v);
  if (!t) { if (obrig) erros.push("cnpj_cpf: obrigatório."); return undefined; }
  if (!tipoDocumento(t)) { erros.push(`cnpj_cpf: “${t}” não é um CNPJ (14 dígitos) nem um CPF (11 dígitos) válido.`); return undefined; }
  return digitos(t);
}

/* ───────── Clientes (dedup por CNPJ/CPF) ───────── */
const clientes: DefImportacao = {
  entidade: "clientes", singular: "cliente", plural: "clientes", chaveDescricao: "CNPJ/CPF",
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
  ],
  validar(v, ctx) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
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
      ok: true, rotulo, chaves: [`doc:${doc}`],
      dados: {
        nome: rotulo, cpfCnpj: formatarDocumento(doc!), tipoPessoa: tipo.valor ?? tipoDoc,
        nomeFantasia: texto(v.nome_fantasia), inscricaoEstadual: texto(v.inscricao_estadual),
        email: email?.toLowerCase(), telefone: texto(v.telefone), celular: texto(v.celular), contato: texto(v.contato),
        cep: cep ? digitos(cep).replace(/(\d{5})(\d{3})/, "$1-$2") : undefined,
        endereco: texto(v.endereco), numero: texto(v.numero), complemento: texto(v.complemento), bairro: texto(v.bairro),
        cidade: texto(v.cidade), estado: uf.valor, segmento: seg.valor, origem: ori.valor, tabelaPrecoId: tab.valor,
        observacoes: texto(v.observacoes),
      },
    };
  },
};

/* ───────── Fornecedores (dedup por CNPJ/CPF; sem documento, pelo nome) ───────── */
const fornecedores: DefImportacao = {
  entidade: "fornecedores", singular: "fornecedor", plural: "fornecedores", chaveDescricao: "CNPJ/CPF (ou nome, sem documento)",
  colunas: [
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome / razão social", exemplo: "Frigelar Distribuidora", apelidos: ["razao_social", "fornecedor"] },
    { chave: "cnpj_cpf", titulo: "cnpj_cpf", ajuda: "CNPJ ou CPF (chave para não duplicar; sem ele, vale o nome)", exemplo: "11.444.777/0001-61", apelidos: ["cnpj", "cpf", "cpf_cnpj", "documento"] },
    { chave: "telefone", titulo: "telefone", ajuda: "Telefone", exemplo: "(11) 3333-4444", apelidos: ["fone", "celular"] },
    { chave: "email", titulo: "email", ajuda: "E-mail", exemplo: "vendas@frigelar.com.br", apelidos: ["e_mail"] },
    { chave: "observacoes", titulo: "observacoes", ajuda: "Observações", exemplo: "Gás e peças", apelidos: ["obs", "observacao"] },
  ],
  validar(v) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const doc = lerDocumento(v.cnpj_cpf, erros, false);
    const email = texto(v.email);
    if (email && !EMAIL.test(email)) erros.push(`email: “${email}” não é um e-mail válido.`);
    const chaves = doc ? [`doc:${doc}`] : [`nome:${chaveNome(rotulo)}`];
    return validarPeloCadastro(CADASTROS.fornecedores, {
      nome: rotulo || undefined, documento: doc, telefone: texto(v.telefone), email: email?.toLowerCase(), observacoes: texto(v.observacoes),
    }, erros, rotulo, chaves);
  },
};

/* ───────── Serviços e produtos (dedup pelo nome: não há código próprio no cadastro) ───────── */
const servicos: DefImportacao = {
  entidade: "servicos", singular: "serviço", plural: "serviços", chaveDescricao: "nome",
  colunas: [
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome do serviço (chave para não duplicar)", exemplo: "Manutenção preventiva split", apelidos: ["servico", "descricao_do_servico"] },
    { chave: "descricao", titulo: "descricao", ajuda: "Descrição", exemplo: "Limpeza de filtros e serpentina" },
    { chave: "unidade", titulo: "unidade", ajuda: "Unidade de cobrança (vazio = un)", exemplo: "un", opcoes: UNIDADES_SERVICO.map((u) => u.rotulo), apelidos: ["un", "und"] },
    { chave: "valor_padrao", titulo: "valor_padrao", ajuda: "Valor em R$ (ex.: 250,00)", exemplo: "250,00", apelidos: ["valor", "preco", "preco_padrao"] },
    { chave: "codigo_municipal", titulo: "codigo_municipal", ajuda: "Código do serviço na prefeitura (NFS-e)", exemplo: "", apelidos: ["codigo_servico"] },
    { chave: "codigo_lc116", titulo: "codigo_lc116", ajuda: "Item da LC 116 (ex.: 14.01)", exemplo: "14.01", apelidos: ["lc116", "item_lc116"] },
    { chave: "aliquota_iss", titulo: "aliquota_iss", ajuda: "Alíquota de ISS em %", exemplo: "5", apelidos: ["iss"] },
  ],
  validar(v) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const un = opcao(v.unidade, UNIDADES_SERVICO, "unidade");
    if (un.erro) erros.push(un.erro);
    const valor = lerNumero(v.valor_padrao, "valor_padrao", erros);
    const iss = lerNumero(v.aliquota_iss, "aliquota_iss", erros);
    return validarPeloCadastro(CADASTROS.servicos, {
      nome: rotulo || undefined, descricao: texto(v.descricao), unidade: un.valor, valorPadrao: valor,
      codigoMunicipal: texto(v.codigo_municipal), codigoLc116: texto(v.codigo_lc116), aliquotaISS: iss,
    }, erros, rotulo, [`nome:${chaveNome(rotulo)}`]);
  },
};

const produtos: DefImportacao = {
  entidade: "produtos", singular: "produto", plural: "produtos", chaveDescricao: "nome",
  colunas: [
    { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome do produto (chave para não duplicar)", exemplo: "Gás R410A cilindro 11 kg", apelidos: ["produto"] },
    { chave: "descricao", titulo: "descricao", ajuda: "Descrição", exemplo: "Fluido refrigerante" },
    { chave: "unidade", titulo: "unidade", ajuda: "Unidade (vazio = un)", exemplo: "kg", opcoes: UNIDADES_PRODUTO.map((u) => u.rotulo), apelidos: ["un", "und"] },
    { chave: "valor_padrao", titulo: "valor_padrao", ajuda: "Valor em R$ (ex.: 1.250,00)", exemplo: "890,00", apelidos: ["valor", "preco", "preco_padrao"] },
    { chave: "estoque_minimo", titulo: "estoque_minimo", ajuda: "Estoque mínimo (número inteiro)", exemplo: "5", apelidos: ["estoque", "minimo"] },
  ],
  validar(v) {
    const erros: string[] = [];
    const rotulo = texto(v.nome) ?? "";
    if (!rotulo) erros.push("nome: obrigatório.");
    const un = opcao(v.unidade, UNIDADES_PRODUTO, "unidade");
    if (un.erro) erros.push(un.erro);
    const valor = lerNumero(v.valor_padrao, "valor_padrao", erros);
    const estoque = lerNumero(v.estoque_minimo, "estoque_minimo", erros, { inteiro: true });
    return validarPeloCadastro(CADASTROS.produtos, {
      nome: rotulo || undefined, descricao: texto(v.descricao), unidade: un.valor, valorPadrao: valor, estoqueMinimo: estoque,
    }, erros, rotulo, [`nome:${chaveNome(rotulo)}`]);
  },
};

export const IMPORTACOES: Record<EntidadeImportacao, DefImportacao> = { clientes, fornecedores, servicos, produtos };
export type { ContextoImportacao };
