import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { ROTULO_COBRANCA } from "@/lib/execucao/adicional";

type Params = { params: Promise<{ id: string; servicoId: string }> };

const schema = z.object({ statusCobranca: z.enum(["A_AVALIAR", "COBRAR", "NAO_COBRAR"]) }).strict();

/**
 * O escritório decide a COBRANÇA do serviço adicional (a avaliar → cobrar / não cobrar). O técnico
 * não mexe nisso. A cobrança em si (orçamento/fatura) é a Etapa 3.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { id, servicoId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Situação de cobrança inválida." }, { status: 400 });
  const s = await prisma.servicoAdicional.findFirst({ where: { id: servicoId, ordemServicoId: id, empresaId: guard.session.user.empresaId }, select: { id: true, descricao: true, statusCobranca: true } });
  if (!s) return NextResponse.json({ erro: "Serviço adicional não encontrado" }, { status: 404 });
  const { statusCobranca } = parsed.data;
  if (statusCobranca !== s.statusCobranca) {
    await prisma.servicoAdicional.update({ where: { id: s.id }, data: { statusCobranca } });
    await prisma.osHistorico.create({
      data: {
        ordemServicoId: id, usuarioId: guard.session.user.id, acao: "Serviço adicional: cobrança",
        detalhes: `"${s.descricao.slice(0, 80)}": ${ROTULO_COBRANCA[s.statusCobranca]} → ${ROTULO_COBRANCA[statusCobranca]}`,
      },
    });
  }
  return NextResponse.json({ id: s.id, statusCobranca });
}
