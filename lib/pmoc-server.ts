import { prisma } from "@/lib/prisma";
import { TIPOS_ART, TAMANHO_MAX_ART, type PmocInput } from "@/lib/pmoc";
import { validarDataUrl } from "@/lib/anexos-server";

export class ErroPmoc extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Seleção usada no editor (nunca traz o arquivo da ART, só os metadados). */
export const SELECT_PMOC = {
  id: true, nome: true, descricao: true, clienteId: true, unidadeId: true, dataInicio: true, dataExpiracao: true, status: true,
  responsavelTecnicoId: true, rtNome: true, rtCrea: true, artNumero: true, artArquivoNome: true, artArquivoTipo: true,
  artArquivoTamanho: true, ativo: true, criadoEm: true, atualizadoEm: true,
  cliente: { select: { id: true, nome: true, nomeFantasia: true } },
  unidade: { select: { id: true, nome: true, cidade: true, estado: true } },
  equipamentos: {
    orderBy: { criadoEm: "asc" as const },
    select: {
      id: true,
      equipamento: {
        select: {
          id: true, nome: true, marca: true, modelo: true, patrimonio: true, tipo: true, capacidade: true, setor: true,
          localizacao: true, ativo: true, unidadeId: true,
          tipoEquipamento: { select: { nome: true } },
          unidade: { select: { nome: true } },
        },
      },
    },
  },
} as const;

/** Unidade do cliente, cliente e RT da mesma empresa — nada de vínculo entre empresas. */
export async function validarVinculos(empresaId: string, d: Pick<PmocInput, "clienteId" | "unidadeId" | "responsavelTecnicoId">) {
  const unidade = await prisma.unidade.findFirst({ where: { id: d.unidadeId, empresaId, clienteId: d.clienteId }, select: { id: true } });
  if (!unidade) throw new ErroPmoc("A unidade/local não pertence a este cliente.");
  if (d.responsavelTecnicoId) {
    const rt = await prisma.tecnico.findFirst({ where: { id: d.responsavelTecnicoId, empresaId }, select: { id: true } });
    if (!rt) throw new ErroPmoc("Responsável técnico inválido.");
  }
}

export const MSG_ART_GRANDE = "Arquivo da ART acima de 3 MB.";

/** O que mudou no arquivo da ART neste salvamento, para o histórico do plano (null = nada) */
export function mudancaDaArt(d: Pick<PmocInput, "artArquivo" | "artArquivoNome" | "removerArt">, nomeAnterior: string | null): { acao: string; detalhes: string | null } | null {
  if (d.removerArt) return nomeAnterior ? { acao: "Arquivo da ART excluído", detalhes: nomeAnterior } : null;
  if (!d.artArquivo) return null;
  return { acao: nomeAnterior ? "Arquivo da ART trocado" : "Arquivo da ART anexado", detalhes: (d.artArquivoNome ?? "ART").slice(0, 200) };
}

/** Dados do arquivo da ART a partir do body: troca, remove ou mantém (undefined). */
export function dadosArt(d: Pick<PmocInput, "artArquivo" | "artArquivoNome" | "removerArt">) {
  if (d.removerArt) return { artArquivo: null, artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null };
  if (!d.artArquivo) return {};
  if (!/^data:[^;,]+;base64,[A-Za-z0-9+/=]+$/.test(d.artArquivo)) throw new ErroPmoc("Arquivo da ART inválido.");
  // O tipo é o do CONTEÚDO (primeiros bytes), não o que o navegador declarou: é este arquivo que entra no documento
  const r = validarDataUrl(d.artArquivo, d.artArquivoNome ?? "ART", { tipos: TIPOS_ART, tamanhoMax: TAMANHO_MAX_ART, mensagemTipo: "A ART deve ser PDF, JPG ou PNG." });
  if (!r.ok) throw new ErroPmoc(/muito grande/.test(r.erro) ? MSG_ART_GRANDE : r.erro, /muito grande/.test(r.erro) ? 413 : 400);
  return { artArquivo: r.arquivo.conteudo, artArquivoNome: (d.artArquivoNome ?? "ART").slice(0, 200), artArquivoTipo: r.arquivo.tipo, artArquivoTamanho: r.arquivo.tamanho };
}

export const paraData = (iso: string) => new Date(`${iso}T00:00:00Z`);
