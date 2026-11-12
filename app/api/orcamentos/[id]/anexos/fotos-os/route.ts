import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { carregarGaleria } from "@/lib/os/galeria-server";
import {
  MAX_ANEXOS_ORCAMENTO, MSG_LIMITE_ANEXOS, MSG_SO_RASCUNHO, SELECT_ANEXO_ORCAMENTO,
  fotoDaOsParaCopiar, orcamentoParaAnexos, proximaOrdem,
} from "@/lib/orcamentos/anexos-server";

type Params = { params: Promise<{ id: string }> };

/**
 * As fotos de Fotos & Anexos das OS VINCULADAS ao orçamento, para escolher quais vão na proposta.
 * Exige ver orçamentos E ordens (a galeria é da OS).
 */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const guardOs = await exigirPermissao("ordens", "visualizar");
  if (guardOs.erro) return guardOs.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const orc = await orcamentoParaAnexos(empresaId, id);
  if (!orc) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  const osIds = orc.ordensServico.map((o) => o.ordemServicoId);
  const ordens = await prisma.ordemServico.findMany({ where: { id: { in: osIds }, empresaId }, select: { id: true, numero: true }, orderBy: { numero: "asc" } });
  const grupos = await Promise.all(ordens.map(async (os) => {
    const g = await carregarGaleria(empresaId, os.id);
    const equip = new Map(g.equipamentos.map((e) => [e.id, e.titulo]));
    return {
      os: { id: os.id, numero: os.numero },
      fotos: g.fotos.map((f) => ({ origem: f.origem, id: f.id, src: f.src, legenda: f.legenda, equipamento: f.equipamentoId ? equip.get(f.equipamentoId) ?? null : null })),
    };
  }));
  return NextResponse.json(grupos, { headers: { "Cache-Control": "private, no-store" } });
}

const corpoSchema = z.object({
  fotos: z.array(z.object({ origem: z.enum(["EXECUCAO", "ADICIONAL", "ANEXO"]), id: z.string().min(1) })).min(1).max(MAX_ANEXOS_ORCAMENTO),
});

/** Copia as fotos escolhidas para a proposta (congeladas nela). Só fotos das OS vinculadas. */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;
  const orc = await orcamentoParaAnexos(empresaId, id);
  if (!orc) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orc.status !== "RASCUNHO") return NextResponse.json({ erro: MSG_SO_RASCUNHO }, { status: 409 });
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Escolha ao menos uma foto." }, { status: 400 });
  const pedidas = [...new Map(parsed.data.fotos.map((f) => [`${f.origem}:${f.id}`, f])).values()];
  if (orc._count.anexos + pedidas.length > MAX_ANEXOS_ORCAMENTO) return NextResponse.json({ erro: MSG_LIMITE_ANEXOS }, { status: 400 });

  const osIds = orc.ordensServico.map((o) => o.ordemServicoId);
  const copias = [];
  for (const f of pedidas) {
    const foto = await fotoDaOsParaCopiar(empresaId, osIds, f.origem, f.id);
    // Foto de OS não vinculada, de outra empresa ou que não é imagem: recusa tudo (nada pela metade)
    if (!foto) return NextResponse.json({ erro: "Foto inválida: escolha fotos das OS vinculadas a este orçamento." }, { status: 400 });
    copias.push(foto);
  }
  const ordem = await proximaOrdem(id);
  const criados = await prisma.$transaction(copias.map((c, i) => prisma.orcamentoAnexo.create({
    data: {
      empresaId, orcamentoId: id, tipo: "FOTO", nome: `Foto ${ordem + i + 1}`, mime: c.mime, tamanho: c.tamanho,
      conteudo: c.conteudo, legenda: c.legenda, origem: c.origem, ordem: ordem + i, criadoPorId: session.user!.id,
    },
    select: SELECT_ANEXO_ORCAMENTO,
  })));
  return NextResponse.json(criados, { status: 201 });
}
