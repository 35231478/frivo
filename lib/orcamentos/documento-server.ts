import type { Prisma } from "@prisma/client";
import { ordenarAnexos, SELECT_ANEXO_ORCAMENTO, type AnexoOrcamentoMeta } from "@/lib/orcamentos/anexos-server";
import type { AnexoDocumento } from "@/components/orcamento/orcamento-documento";
import { tituloArquivoOrcamento } from "@/lib/orcamentos/proposta";
import { prisma } from "@/lib/prisma";

/** Material do serviço no documento do cliente: sem o custo (custoUnit fica de fora de propósito). */
export const SELECT_MATERIAL_DOCUMENTO = {
  descricao: true, unidade: true, quantidade: true, valorVendaUnit: true, comportamento: true, ordem: true,
} satisfies Prisma.OrcamentoMaterialSelect;

/** A "versão do cliente" da OS: o relatório GERAL (link público com token), o mais recente. */
export const SELECT_RELATORIO_CLIENTE_OS = {
  where: { escopo: "GERAL" }, orderBy: { criadoEm: "desc" }, take: 1,
  select: { tokenPublico: true, escopo: true, empresaId: true },
} satisfies Prisma.OrdemServico$relatoriosArgs;

/**
 * O que o documento do orçamento precisa — UMA definição para o link público, a impressão e a tela
 * interna (o mesmo estado nos três): timbre (empresa), "Para:" (cliente, unidade e contato A/C),
 * RT, itens e os anexos (só metadados; o arquivo é servido à parte).
 */
export const INCLUDE_DOCUMENTO_ORCAMENTO = {
  empresa: true,
  cliente: true,
  responsavelTecnico: { select: { nome: true, crea: true } },
  unidade: { select: { nome: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true } },
  contatoCliente: { select: { nome: true, cargo: true, email: true, telefone: true, whatsapp: true } },
  anexos: { select: SELECT_ANEXO_ORCAMENTO },
  // O nome ATUAL do catálogo: o documento separa "Nome — descrição cadastrada" em nome + descrição discreta.
  // Leva D: os materiais de cada serviço, só o que o cliente pode ver (descrição, quantidade, preço de venda) —
  // NUNCA o custo. Aparecem no documento só com a opção "Mostrar materiais" (lib/orcamentos/documento-opcoes).
  servicos: {
    orderBy: { ordem: "asc" },
    include: { servico: { select: { nome: true } }, materiais: { orderBy: { ordem: "asc" }, select: SELECT_MATERIAL_DOCUMENTO } },
  },
  produtos: { orderBy: { ordem: "asc" }, include: { produto: { select: { nome: true } } } },
  // OS vinculadas: o número sai no cabeçalho do documento (lib/orcamentos/proposta → numerosOsDoDocumento)
  // e vira link para a "versão do cliente" da OS (relatório GERAL, /relatorio/os/<token>) quando ela existe
  ordensServico: { select: { ordemServico: { select: { numero: true, criadoEm: true, empresaId: true, relatorios: SELECT_RELATORIO_CLIENTE_OS } } } },
} satisfies Prisma.OrcamentoInclude;

/** Título da página do documento (= nome sugerido ao salvar em PDF): "Orçamento 2026-0015 - Cliente" */
export async function metadataDocumentoOrcamento(token: string) {
  const o = await prisma.orcamento.findUnique({ where: { tokenPublico: token }, select: { codigo: true, cliente: { select: { nome: true } } } });
  // "absolute": sem o " | Frivo" do layout — o título vira o nome do arquivo como está
  return { title: { absolute: o ? tituloArquivoOrcamento(o.codigo, o.cliente?.nome) : "Orçamento" } };
}

/**
 * Os anexos no formato do documento, com o link de cada um: no link público
 * `/api/publico/orcamentos/<token>/anexos`, na tela interna `/api/orcamentos/<id>/anexos`.
 */
export function anexosDoDocumento(anexos: AnexoOrcamentoMeta[], base: string): AnexoDocumento[] {
  return ordenarAnexos(anexos).map((a) => ({
    id: a.id, tipo: a.tipo === "FOTO" ? "FOTO" : "ARQUIVO", nome: a.nome, mime: a.mime, tamanho: a.tamanho,
    legenda: a.legenda, origem: a.origem, url: `${base}/${a.id}`,
  }));
}
