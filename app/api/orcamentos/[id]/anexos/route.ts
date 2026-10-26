import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { validarArquivoUpload } from "@/lib/anexos-server";
import { limparLegenda } from "@/lib/os/galeria";
import {
  MAX_ANEXOS_ORCAMENTO, MSG_LIMITE_ANEXOS, MSG_SO_RASCUNHO, SELECT_ANEXO_ORCAMENTO,
  orcamentoParaAnexos, ordenarAnexos, proximaOrdem, tipoAnexoPorMime,
} from "@/lib/orcamentos/anexos-server";

type Params = { params: Promise<{ id: string }> };

/** Anexos da proposta (só metadados; o arquivo é servido em /anexos/[anexoId]). */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const orc = await orcamentoParaAnexos(empresaId, id);
  if (!orc) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  const anexos = await prisma.orcamentoAnexo.findMany({ where: { orcamentoId: id, empresaId }, select: SELECT_ANEXO_ORCAMENTO });
  return NextResponse.json(ordenarAnexos(anexos), { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Envia um arquivo para a proposta (datasheet, catálogo, foto). Tipo decidido pelos BYTES (bloqueia
 * HTML/SVG/scripts); imagem vira FOTO (registro fotográfico do documento), o resto ARQUIVO.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;
  const orc = await orcamentoParaAnexos(empresaId, id);
  if (!orc) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orc.status !== "RASCUNHO") return NextResponse.json({ erro: MSG_SO_RASCUNHO }, { status: 409 });
  if (orc._count.anexos >= MAX_ANEXOS_ORCAMENTO) return NextResponse.json({ erro: MSG_LIMITE_ANEXOS }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("arquivo");
  if (!(file instanceof File)) return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  const v = await validarArquivoUpload(file);
  if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400 });

  const anexo = await prisma.orcamentoAnexo.create({
    data: {
      empresaId, orcamentoId: id, tipo: tipoAnexoPorMime(v.arquivo.tipo), nome: v.arquivo.nome, mime: v.arquivo.tipo,
      tamanho: v.arquivo.tamanho, conteudo: v.arquivo.conteudo, legenda: limparLegenda(form!.get("legenda")),
      ordem: await proximaOrdem(id), criadoPorId: session.user!.id,
    },
    select: SELECT_ANEXO_ORCAMENTO,
  });
  return NextResponse.json(anexo, { status: 201 });
}
