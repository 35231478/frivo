/**
 * "Exportar dados da empresa (backup portátil)" — a parte PURA: o formato do CSV, o catálogo dos arquivos do
 * pacote (nome, o que contém, em que parte entra, se é compatível com a importação) e o LEIA-ME.
 *
 * Formato de cada planilha: CSV em UTF-8 COM BOM (o Excel abre com acento certo com dois cliques), separador `;`,
 * fim de linha CRLF, aspas só quando precisa (`;`, aspas, quebra de linha ou espaço nas pontas). Datas em
 * dd/mm/aaaa (dia civil) ou dd/mm/aaaa HH:mm (instante, no relógio de Brasília); números com vírgula ("1250,50").
 *
 * Os arquivos dos cadastros que a Implantação importa saem nas MESMAS colunas da planilha de importação
 * (lib/importacao/entidades), com o id_sistema: dá para restaurar em outra empresa pela Implantação.
 */
import { chaveDiaBR, chaveDiaCivil, dataHoraMarca } from "@/lib/fuso";
import type { EntidadeImportacao } from "@/lib/importacao/entidades";

/* ───────── o CSV ───────── */

export const BOM = "﻿";
export const SEPARADOR = ";";
export const FIM_LINHA = "\r\n";

/** Uma célula: aspas quando tem separador, aspas, quebra de linha ou espaço nas pontas; aspas internas dobradas. */
export function celulaCsv(v: unknown): string {
  const t = v === null || v === undefined ? "" : String(v);
  return /[;"\r\n]|^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export const linhaCsv = (celulas: readonly unknown[]) => celulas.map(celulaCsv).join(SEPARADOR) + FIM_LINHA;

/* ───────── os valores ───────── */

/** Dia civil (vencimento, início, validade…) → "dd/mm/aaaa"; vazio sem data. */
export function dia(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const [a, m, di] = chaveDiaCivil(x).split("-");
  return `${di}/${m}/${a}`;
}

/** Instante (criado em, concluída em…) → "dd/mm/aaaa HH:mm" em Brasília; vazio sem data. */
export function instante(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? "" : dataHoraMarca(x);
}

/** Número no formato BR, sem separador de milhar ("1250,5"; com casas: "1250,50"). Vazio sem número. */
export function numero(v: unknown, casas?: number): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return (casas === undefined ? String(n) : n.toFixed(casas)).replace(".", ",");
}

export const dinheiro = (v: unknown) => numero(v, 2);
export const simNao = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "");
/** Rótulo de um valor de lista (ex.: status); valor desconhecido sai como está. */
export const rotulo = (mapa: Record<string, string>, v: unknown) => (v === null || v === undefined ? "" : mapa[String(v)] ?? String(v));

/* ───────── o catálogo do pacote ───────── */

export const PARTES = ["tudo", "cadastros", "operacao", "financeiro"] as const;
export type Parte = (typeof PARTES)[number];
export const ehParte = (v: unknown): v is Parte => typeof v === "string" && (PARTES as readonly string[]).includes(v);
export const ROTULO_PARTE: Record<Parte, string> = { tudo: "Tudo", cadastros: "Cadastros", operacao: "Operação", financeiro: "Financeiro" };

export type ArquivoId =
  | "clientes" | "unidades" | "contatos" | "equipamentos" | "fornecedores" | "servicos" | "produtos" | "estoque" | "colaboradores" | "veiculos"
  | "contratos" | "pmocs"
  | "os" | "os_itens" | "os_atividades" | "orcamentos" | "orcamentos_itens"
  | "contas_receber" | "contas_pagar";

export interface DefArquivo {
  id: ArquivoId;
  /** Nome dentro do zip (com o número, para a ordem de restaurar ficar clara) */
  nome: string;
  parte: Exclude<Parte, "tudo">;
  /** Uma linha do LEIA-ME: o que o arquivo tem */
  descricao: string;
  /** Compatível com a planilha de importação deste cadastro (mesmas colunas) */
  importacao?: EntidadeImportacao;
}

export const ARQUIVOS: readonly DefArquivo[] = [
  { id: "clientes", nome: "01-clientes.csv", parte: "cadastros", importacao: "clientes", descricao: "Clientes (razão social, CNPJ/CPF, endereço principal, contatos de cobrança)." },
  { id: "unidades", nome: "02-unidades.csv", parte: "cadastros", importacao: "unidades", descricao: "Unidades / endereços de atendimento de cada cliente." },
  { id: "contatos", nome: "03-contatos.csv", parte: "cadastros", importacao: "contatos", descricao: "Pessoas de contato dos clientes (sem a senha do portal)." },
  { id: "equipamentos", nome: "04-equipamentos.csv", parte: "cadastros", importacao: "equipamentos", descricao: "Equipamentos de cada unidade (tipo, marca, modelo, série, capacidade)." },
  { id: "fornecedores", nome: "05-fornecedores.csv", parte: "cadastros", importacao: "fornecedores", descricao: "Fornecedores." },
  { id: "servicos", nome: "06-servicos.csv", parte: "cadastros", importacao: "servicos", descricao: "Catálogo de serviços (código, nome, valor padrão)." },
  { id: "produtos", nome: "07-produtos.csv", parte: "cadastros", importacao: "produtos", descricao: "Catálogo de produtos (código, nome, unidade, valor, Uso: Material ou Peça)." },
  { id: "estoque", nome: "08-estoque.csv", parte: "cadastros", importacao: "estoque", descricao: "Saldo de estoque de cada produto que controla estoque (com o último custo)." },
  { id: "colaboradores", nome: "09-colaboradores.csv", parte: "cadastros", importacao: "colaboradores", descricao: "Colaboradores: só o cadastro operacional (sem salário, senha, dados bancários ou documentos pessoais)." },
  { id: "veiculos", nome: "10-veiculos.csv", parte: "cadastros", importacao: "veiculos", descricao: "Veículos da frota." },
  { id: "contratos", nome: "11-contratos.csv", parte: "cadastros", importacao: "contratos", descricao: "Contratos de manutenção (cliente, tipo, situação, vigência, valor, unidades cobertas)." },
  { id: "pmocs", nome: "12-pmoc.csv", parte: "cadastros", importacao: "pmocs", descricao: "Planos PMOC (cliente, unidade, vigência, equipamentos, responsável técnico)." },
  { id: "os", nome: "13-os.csv", parte: "operacao", descricao: "Ordens de serviço: cabeçalho (número, cliente, unidade, situação, datas, valores)." },
  { id: "os_itens", nome: "14-os-itens.csv", parte: "operacao", descricao: "Itens de cada OS (serviços e produtos, quantidade, valores, executado)." },
  { id: "os_atividades", nome: "15-os-atividades.csv", parte: "operacao", descricao: "Atividades de cada OS (técnico, agendada, concluída, situação, resumo)." },
  { id: "orcamentos", nome: "16-orcamentos.csv", parte: "operacao", descricao: "Orçamentos: cabeçalho (código, cliente, situação, validade, totais)." },
  { id: "orcamentos_itens", nome: "17-orcamentos-itens.csv", parte: "operacao", descricao: "Itens de cada orçamento (serviços e produtos, quantidade, valores)." },
  { id: "contas_receber", nome: "18-contas-receber.csv", parte: "financeiro", descricao: "Contas a receber (cliente, vencimento, valor, recebido, situação)." },
  { id: "contas_pagar", nome: "19-contas-pagar.csv", parte: "financeiro", descricao: "Contas a pagar (fornecedor, vencimento, valor, pago, situação)." },
];

/** Os arquivos de uma parte ("tudo" = todos, na ordem). */
export const arquivosDaParte = (p: Parte) => ARQUIVOS.filter((a) => p === "tudo" || a.parte === p);

/** Os arquivos que não têm planilha de importação (colunas próprias; os outros usam as colunas da importação). */
export type ArquivoProprio = "os" | "os_itens" | "os_atividades" | "orcamentos" | "orcamentos_itens" | "contas_receber" | "contas_pagar";
export const COLUNAS: Record<ArquivoProprio, readonly string[]> = {
  os: ["numero", "cliente_cnpj_cpf", "cliente", "unidade", "contrato", "orcamento_origem", "descricao", "prioridade", "situacao", "origem", "responsavel",
    "previsao_conclusao", "prazo_execucao", "data_inicio", "data_conclusao", "total_servicos", "total_produtos", "total", "observacoes", "criada_em", "id_sistema"],
  os_itens: ["os_numero", "ordem", "tipo", "descricao", "quantidade", "valor_unitario", "valor_total", "executado", "executado_em", "id_sistema"],
  os_atividades: ["os_numero", "titulo", "situacao", "tecnico", "data_agendada", "prazo", "iniciada_em", "concluida_em", "duracao_min", "observacao", "resumo", "id_sistema"],
  orcamentos: ["codigo", "nome", "cliente_cnpj_cpf", "cliente", "unidade", "tipo", "situacao", "validade", "total_servicos", "total_produtos", "desconto",
    "valor_iss", "total_geral", "forma_pagamento", "condicao_pagamento", "garantia_servico", "garantia_pecas", "enviado_em", "aprovado_em", "aprovado_por", "criado_em", "id_sistema"],
  orcamentos_itens: ["orcamento_codigo", "ordem", "tipo", "descricao", "quantidade", "valor_unitario", "valor_total", "observacao", "id_sistema"],
  contas_receber: ["numero", "cliente_cnpj_cpf", "cliente", "descricao", "valor", "valor_recebido", "situacao", "vencimento", "recebido_em", "forma_pagamento",
    "parcela", "categoria", "referencia", "contrato", "orcamento", "observacao", "criada_em", "id_sistema"],
  contas_pagar: ["numero", "fornecedor", "fornecedor_cnpj", "descricao", "valor", "valor_pago", "saldo", "situacao", "vencimento", "pago_em", "forma_pagamento",
    "referencia", "observacao", "criada_em", "id_sistema"],
};

/* ───────── o LEIA-ME ───────── */

export interface InfoLeiaMe {
  empresa: string;
  cnpj?: string | null;
  geradoEm: Date;
  geradoPor: string;
  parte: Parte;
}

/** O LEIA-ME.txt: data, empresa, o que cada arquivo tem, o formato e o que fica de fora. */
export function leiaMe(i: InfoLeiaMe): string {
  const arquivos = arquivosDaParte(i.parte);
  const linhas = [
    "FRIVO — DADOS EXPORTADOS DA EMPRESA",
    "",
    `Empresa: ${i.empresa}${i.cnpj ? ` (CNPJ ${i.cnpj})` : ""}`,
    `Gerado em: ${instante(i.geradoEm)} (horário de Brasília)`,
    `Gerado por: ${i.geradoPor}`,
    `Parte: ${ROTULO_PARTE[i.parte]}`,
    "",
    "ARQUIVOS",
    ...arquivos.map((a) => `- ${a.nome}: ${a.descricao}${a.importacao ? " [mesmas colunas da importação]" : ""}`),
    "",
    "FORMATO",
    "- Uma planilha CSV por cadastro, em UTF-8 com BOM, separada por ponto e vírgula (;). Abre direto no Excel.",
    "- Datas: dd/mm/aaaa; data e hora em horário de Brasília. Valores: vírgula decimal, sem separador de milhar.",
    "- id_sistema: o identificador do registro no Frivo (liga os arquivos entre si e evita duplicar na importação).",
    "- Os arquivos marcados [mesmas colunas da importação] podem ser importados em outra empresa pela Implantação",
    "  (Configurações › Implantação), nesta ordem: clientes, unidades, contatos, equipamentos, fornecedores, serviços,",
    "  produtos, estoque, colaboradores, veículos, contratos, PMOC.",
    "",
    "O QUE NÃO ESTÁ AQUI",
    "- Fotos, anexos, PDFs, assinaturas e arquivos enviados (ficam para uma próxima versão).",
    "- Senhas, salários, dados bancários e documentos pessoais dos colaboradores.",
    "- Configurações, usuários e perfis de acesso.",
    "",
    "Guarde este arquivo em lugar seguro: ele contém dados pessoais de clientes e colaboradores (LGPD).",
    "",
  ];
  return linhas.join(FIM_LINHA);
}

/** Nome do .zip: "frivo-dados-<empresa>-<parte>-<aaaa-mm-dd>.zip", só com letras, números e hífen. */
export function nomeDoZip(empresa: string, parte: Parte, quando: Date): string {
  const slug = empresa.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "empresa";
  return `frivo-dados-${slug}${parte === "tudo" ? "" : `-${parte}`}-${chaveDiaBR(quando)}.zip`;
}

/** Só o administrador da empresa exporta (o servidor confere; a tela só esconde). */
export const podeExportar = (role: unknown) => role === "ADMIN" || role === "SUPER_ADMIN";

/* ───────── a trilha (as últimas exportações) ───────── */

export interface RegistroExportacao { criadoEm: Date | string; concluidaEm?: Date | string | null; erro?: string | null }
export type SituacaoExportacao = "concluida" | "andamento" | "falhou";
/** Sem conclusão depois disto, a exportação não termina mais (o limite da função é 5 min). */
export const EXPORTACAO_ABANDONADA_MS = 15 * 60_000;

/** Concluída, em andamento ou falhou (com erro gravado, ou parada há mais de 15 min sem concluir). */
export function situacaoExportacao(r: RegistroExportacao, agora = new Date()): SituacaoExportacao {
  if (r.concluidaEm) return "concluida";
  if (r.erro) return "falhou";
  return agora.getTime() - new Date(r.criadoEm).getTime() > EXPORTACAO_ABANDONADA_MS ? "falhou" : "andamento";
}
