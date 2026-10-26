import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { respostaAnexo } from "@/lib/anexos-server";
import { MSG_SO_RASCUNHO, orcamentoParaAnexos } from "@/lib/orcamentos/anexos-server";

type Params = { params: Promise<{ id: string; anexoId: string }> };

/** Baixa o anexo (?inline=1 abre no navegador — só imagem comum/PDF; o resto é sempre download). */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id, anexoId } = await params;
  const anexo = await prisma.orcamentoAnexo.findFirst({
    where: { id: anexoId, orcamentoId: id, empresaId: guard.session.user!.empresaId },
    select: { nome: true, conteudo: true },
  });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });
  return respostaAnexo(anexo, req.nextUrl.searchParams.get("inline") === "1");
}

/** Tira o anexo da proposta (só em rascunho). */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id, anexoId } = await params;
  const orc = await orcamentoParaAnexos(empresaId, id);
  if (!orc) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orc.status !== "RASCUNHO") return NextResponse.json({ erro: MSG_SO_RASCUNHO }, { status: 409 });
  const r = await prisma.orcamentoAnexo.deleteMany({ where: { id: anexoId, orcamentoId: id, empresaId } });
  if (!r.count) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
