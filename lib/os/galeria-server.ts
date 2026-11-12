/**
 * Fotos & Anexos do serviço — carga do servidor. Só METADADOS (a imagem é servida à parte, pela
 * rota de cada origem): leve para abrir junto com a OS. A empresa SEMPRE vem da sessão de quem chama.
 */
import { prisma } from "@/lib/prisma";
import { apresentarEquipamento, SELECT_EQUIP_EXECUCAO, STATUS_BLOQUEADOS } from "@/lib/execucao/dados";
import {
  ehImagem, legendaAdicional, legendaExecucao,
  type DocumentoGaleria, type EquipamentoGaleria, type FotoGaleria, type Galeria,
} from "@/lib/os/galeria";

/**
 * Os equipamentos DA OS: os vinculados às atividades dela (na ordem em que entraram) e o
 * equipamento principal da OS (aberta pelo QR/ficha do equipamento). São os que valem como
 * referência de uma foto nova.
 */
export async function equipamentosDaOs(empresaId: string, osId: string): Promise<EquipamentoGaleria[]> {
  const [os, vinculos] = await Promise.all([
    prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { equipamento: { select: SELECT_EQUIP_EXECUCAO } } }),
    prisma.atividadeEquipamento.findMany({
      where: { atividade: { ordemServicoId: osId, empresaId } },
      orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
      select: { equipamento: { select: SELECT_EQUIP_EXECUCAO } },
    }),
  ]);
  const lista = [...vinculos.map((v) => v.equipamento), ...(os?.equipamento ? [os.equipamento] : [])];
  const vistos = new Set<string>();
  return lista.filter((e) => (vistos.has(e.id) ? false : (vistos.add(e.id), true))).map(paraGaleria);
}

function paraGaleria(e: Parameters<typeof apresentarEquipamento>[0]): EquipamentoGaleria {
  const a = apresentarEquipamento(e);
  // Dois "Split Hi-Wall" na mesma OS: marca/modelo, TAG e local diferenciam (o tipo só se não estiver no título)
  const tipo = a.tipo?.nome && !a.titulo.includes(a.tipo.nome) ? a.tipo.nome : null;
  return { id: a.id, titulo: a.titulo, detalhe: [tipo, a.fabricante, a.tag && `TAG ${a.tag}`, a.local].filter(Boolean).join(" · ") || null };
}

const atividadeInfo = (a: { id: string; titulo: string; status: string } | null) =>
  (a ? { id: a.id, titulo: a.titulo, aberta: !STATUS_BLOQUEADOS.includes(a.status) } : null);
const SELECT_ATIVIDADE = { select: { id: true, titulo: true, status: true } } as const;
const SELECT_AUTOR = { select: { nome: true } } as const;

/** Um anexo da OS no formato da galeria (foto) — também o que a rota de envio devolve. */
export function fotoDeAnexo(osId: string, a: {
  id: string; legenda: string | null; equipamentoId: string | null; criadoEm: Date;
  atividade: { id: string; titulo: string; status: string } | null; criadoPor: { nome: string } | null;
}): FotoGaleria {
  const legenda = a.legenda ?? "Foto enviada (sem legenda)";
  const src = `/api/ordens/${osId}/anexos/${a.id}`;
  return {
    chave: `ANEXO:${a.id}`, origem: "ANEXO", id: a.id, src: `${src}?inline=1`, baixar: src, legenda,
    equipamentoId: a.equipamentoId, atividade: atividadeInfo(a.atividade), item: null, momento: null,
    enviadoPor: a.criadoPor?.nome ?? null, enviadoEm: a.criadoEm.toISOString(),
    ...(!a.equipamentoId && !a.legenda && { semReferencia: true }),
  };
}

export function documentoDeAnexo(osId: string, a: {
  id: string; nome: string; tipo: string; tamanho: number; legenda: string | null; criadoEm: Date; criadoPor: { nome: string } | null;
}): DocumentoGaleria {
  const src = `/api/ordens/${osId}/anexos/${a.id}`;
  return {
    id: a.id, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, legenda: a.legenda, enviadoPor: a.criadoPor?.nome ?? null,
    enviadoEm: a.criadoEm.toISOString(), src: `${src}?inline=1`, baixar: src,
  };
}

export const SELECT_ANEXO_GALERIA = {
  id: true, nome: true, tipo: true, tamanho: true, legenda: true, equipamentoId: true, criadoEm: true,
  atividade: SELECT_ATIVIDADE, criadoPor: SELECT_AUTOR,
} as const;

/** A galeria da OS: fotos de todas as origens + documentos + os equipamentos (seções). */
export async function carregarGaleria(empresaId: string, osId: string): Promise<Galeria> {
  const [equipamentos, execucao, adicionais, anexos] = await Promise.all([
    equipamentosDaOs(empresaId, osId),
    prisma.fotoAtendimento.findMany({
      where: { empresaId, atividade: { ordemServicoId: osId } },
      select: { id: true, equipamentoId: true, momento: true, criadoEm: true, item: { select: { texto: true } }, atividade: SELECT_ATIVIDADE, criadoPor: SELECT_AUTOR },
    }),
    prisma.servicoAdicionalFoto.findMany({
      where: { empresaId, servico: { ordemServicoId: osId } },
      select: { id: true, criadoEm: true, criadoPor: SELECT_AUTOR, servico: { select: { descricao: true, equipamentoId: true, atividade: SELECT_ATIVIDADE } } },
    }),
    prisma.osAnexo.findMany({ where: { ordemServicoId: osId, ordemServico: { empresaId } }, select: SELECT_ANEXO_GALERIA }),
  ]);

  // Equipamento referenciado por foto mas fora da lista (desvinculado depois): entra com o nome dele
  const conhecidos = new Set(equipamentos.map((e) => e.id));
  const faltando = [...new Set([
    ...execucao.map((f) => f.equipamentoId),
    ...adicionais.map((f) => f.servico.equipamentoId),
    ...anexos.map((a) => a.equipamentoId),
  ].filter((id): id is string => !!id && !conhecidos.has(id)))];
  if (faltando.length) {
    const extras = await prisma.equipamento.findMany({ where: { id: { in: faltando }, empresaId }, select: SELECT_EQUIP_EXECUCAO });
    equipamentos.push(...extras.map(paraGaleria));
  }

  const fotos: FotoGaleria[] = [
    ...execucao.map((f): FotoGaleria => {
      const momento = f.momento ?? null;
      const item = f.item?.texto ?? null;
      const legenda = legendaExecucao({ momento, item });
      const src = `/api/fotos-atendimento/${f.id}`;
      return {
        chave: `EXECUCAO:${f.id}`, origem: "EXECUCAO", id: f.id, src, baixar: src, legenda, equipamentoId: f.equipamentoId,
        atividade: atividadeInfo(f.atividade), item, momento, enviadoPor: f.criadoPor?.nome ?? null, enviadoEm: f.criadoEm.toISOString(),
      };
    }),
    ...adicionais.map((f): FotoGaleria => {
      const src = `/api/servicos-adicionais/fotos/${f.id}`;
      return {
        chave: `ADICIONAL:${f.id}`, origem: "ADICIONAL", id: f.id, src, baixar: src, legenda: legendaAdicional(f.servico.descricao),
        equipamentoId: f.servico.equipamentoId, atividade: atividadeInfo(f.servico.atividade), item: null, momento: null,
        enviadoPor: f.criadoPor?.nome ?? null, enviadoEm: f.criadoEm.toISOString(),
      };
    }),
    ...anexos.filter((a) => ehImagem(a.tipo)).map((a) => fotoDeAnexo(osId, a)),
  ];
  const documentos = anexos.filter((a) => !ehImagem(a.tipo))
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
    .map((a) => documentoDeAnexo(osId, a));

  return { equipamentos, fotos, documentos };
}
