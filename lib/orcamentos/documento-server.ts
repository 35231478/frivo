import type { Prisma } from "@prisma/client";
import { ordenarAnexos, SELECT_ANEXO_ORCAMENTO, type AnexoOrcamentoMeta } from "@/lib/orcamentos/anexos-server";
import type { AnexoDocumento } from "@/components/orcamento/orcamento-documento";

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
  servicos: { orderBy: { ordem: "asc" } },
  produtos: { orderBy: { ordem: "asc" } },
} satisfies Prisma.OrcamentoInclude;

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
