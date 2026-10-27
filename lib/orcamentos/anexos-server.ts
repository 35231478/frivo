/**
 * Anexos da proposta: arquivos enviados (datasheet, catálogo — PDF/Office/imagem) e fotos COPIADAS de
 * Fotos & Anexos das OS vinculadas ao orçamento. A proposta é um documento: a foto fica congelada
 * nela (apagar a foto da OS depois não muda a proposta enviada). Só em RASCUNHO; empresa da sessão.
 */
import { prisma } from "@/lib/prisma";
import { validarFoto } from "@/lib/anexos-server";
import { ehImagem, legendaAdicional, legendaExecucao, limparLegenda } from "@/lib/os/galeria";

export const MAX_ANEXOS_ORCAMENTO = 12;
export const MSG_LIMITE_ANEXOS = `A proposta aceita até ${MAX_ANEXOS_ORCAMENTO} anexos (fotos e arquivos).`;
export const MSG_SO_RASCUNHO = "Os anexos só mudam com o orçamento em rascunho (o documento enviado fica como foi enviado).";

export type OrigemFotoOs = "EXECUCAO" | "ADICIONAL" | "ANEXO";

export const SELECT_ANEXO_ORCAMENTO = {
  id: true, tipo: true, nome: true, mime: true, tamanho: true, legenda: true, origem: true, ordem: true, criadoEm: true,
} as const;

export type AnexoOrcamentoMeta = {
  id: string; tipo: string; nome: string; mime: string; tamanho: number; legenda: string | null; origem: string | null; ordem: number; criadoEm: Date;
};

/** Fotos primeiro (na ordem em que entraram), depois os arquivos. */
export function ordenarAnexos<T extends Pick<AnexoOrcamentoMeta, "tipo" | "ordem" | "criadoEm">>(lista: T[]): T[] {
  return [...lista].sort((a, b) =>
    (a.tipo === "FOTO" ? 0 : 1) - (b.tipo === "FOTO" ? 0 : 1) || a.ordem - b.ordem || a.criadoEm.getTime() - b.criadoEm.getTime());
}

/** Tipo do anexo pelo MIME real: imagem = FOTO (sai no registro fotográfico), resto = ARQUIVO. */
export const tipoAnexoPorMime = (mime: string) => (ehImagem(mime) ? "FOTO" : "ARQUIVO");

/** O orçamento da empresa, com o que a edição de anexos precisa saber. */
export async function orcamentoParaAnexos(empresaId: string, id: string) {
  return prisma.orcamento.findFirst({
    where: { id, empresaId },
    select: { id: true, status: true, _count: { select: { anexos: true } }, ordensServico: { select: { ordemServicoId: true } } },
  });
}

export async function proximaOrdem(orcamentoId: string) {
  const r = await prisma.orcamentoAnexo.aggregate({ where: { orcamentoId }, _max: { ordem: true } });
  return (r._max.ordem ?? -1) + 1;
}

/**
 * Lê uma foto de Fotos & Anexos de uma OS VINCULADA ao orçamento (e da empresa): devolve o conteúdo
 * (revalidado pelos bytes — só imagem comum), a legenda e de onde veio. null = não é foto dessas OS.
 */
export async function fotoDaOsParaCopiar(
  empresaId: string, osIds: readonly string[], origem: OrigemFotoOs, fotoId: string,
): Promise<{ conteudo: string; mime: string; tamanho: number; legenda: string; origem: string } | null> {
  if (!osIds.length) return null;
  const os = { id: { in: [...osIds] }, empresaId };
  let bruto: { conteudo: string; legenda: string; numero: string } | null = null;
  if (origem === "EXECUCAO") {
    const f = await prisma.fotoAtendimento.findFirst({
      where: { id: fotoId, empresaId, atividade: { ordemServico: os } },
      select: { url: true, momento: true, item: { select: { texto: true } }, atividade: { select: { ordemServico: { select: { numero: true } } } } },
    });
    if (f) bruto = { conteudo: f.url, legenda: legendaExecucao({ momento: f.momento ?? null, item: f.item?.texto ?? null }), numero: f.atividade.ordemServico.numero };
  } else if (origem === "ADICIONAL") {
    const f = await prisma.servicoAdicionalFoto.findFirst({
      where: { id: fotoId, empresaId, servico: { ordemServico: os } },
      select: { url: true, servico: { select: { descricao: true, ordemServico: { select: { numero: true } } } } },
    });
    if (f) bruto = { conteudo: f.url, legenda: legendaAdicional(f.servico.descricao), numero: f.servico.ordemServico.numero };
  } else {
    const a = await prisma.osAnexo.findFirst({
      where: { id: fotoId, ordemServico: os },
      select: { conteudo: true, tipo: true, legenda: true, ordemServico: { select: { numero: true } } },
    });
    if (a && ehImagem(a.tipo)) bruto = { conteudo: a.conteudo, legenda: a.legenda ?? "Foto do serviço", numero: a.ordemServico.numero };
  }
  if (!bruto) return null;
  const v = validarFoto(bruto.conteudo);
  if (!v.ok) return null;
  return { conteudo: v.arquivo.conteudo, mime: v.arquivo.tipo, tamanho: v.arquivo.tamanho, legenda: limparLegenda(bruto.legenda) ?? "Foto do serviço", origem: bruto.numero };
}
