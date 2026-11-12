import { prisma } from "@/lib/prisma";
import { TIPOS_ART, TAMANHO_MAX_ART, type PmocInput } from "@/lib/pmoc";

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

/** Dados do arquivo da ART a partir do body: troca, remove ou mantém (undefined). */
export function dadosArt(d: Pick<PmocInput, "artArquivo" | "artArquivoNome" | "removerArt">) {
  if (d.removerArt) return { artArquivo: null, artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null };
  if (!d.artArquivo) return {};
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(d.artArquivo);
  if (!m) throw new ErroPmoc("Arquivo da ART inválido.");
  if (!(TIPOS_ART as readonly string[]).includes(m[1])) throw new ErroPmoc("A ART deve ser PDF, JPG ou PNG.");
  const tamanho = Math.floor((m[2].length * 3) / 4);
  if (tamanho > TAMANHO_MAX_ART) throw new ErroPmoc("Arquivo da ART acima de 5 MB.", 413);
  return { artArquivo: d.artArquivo, artArquivoNome: (d.artArquivoNome ?? "ART").slice(0, 200), artArquivoTipo: m[1], artArquivoTamanho: tamanho };
}

export const paraData = (iso: string) => new Date(`${iso}T00:00:00Z`);
