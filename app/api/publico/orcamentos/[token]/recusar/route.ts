import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { diaCivilPassou } from "@/lib/fuso";
import { ipDaRequisicao, MOTIVO_RECUSA_MAX, MOTIVO_RECUSA_MIN } from "@/lib/orcamentos/ciclo";
import { avisarResponsavel, registrarEvento } from "@/lib/orcamentos/ciclo-server";

const recusaSchema = z.object({
  nome: z.string().trim().min(3, "Informe seu nome.").max(120),
  motivo: z.string().trim().min(MOTIVO_RECUSA_MIN, "Conte o motivo da recusa.").max(MOTIVO_RECUSA_MAX, "Motivo muito longo."),
});

/**
 * Recusa no link público: nome de quem recusa e o motivo, com data/hora e IP. Mesmas regras do
 * aceite (só ENVIADO e dentro da validade; troca atômica). Avisa o responsável (e-mail + sino).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = recusaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const e = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ erro: e.nome?.[0] ?? e.motivo?.[0] ?? "Dados inválidos" }, { status: 400 });
  }

  const orcamento = await prisma.orcamento.findUnique({ where: { tokenPublico: token }, select: { id: true, empresaId: true, status: true, validadeEm: true } });
  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orcamento.status !== "ENVIADO") return NextResponse.json({ erro: "Este orçamento não está disponível para resposta" }, { status: 400 });
  if (diaCivilPassou(orcamento.validadeEm)) return NextResponse.json({ erro: "Orçamento expirado" }, { status: 410 });

  const ip = ipDaRequisicao(req.headers);
  const r = await prisma.orcamento.updateMany({
    where: { id: orcamento.id, status: "ENVIADO" },
    data: { status: "REPROVADO", recusadoEm: new Date(), recusadoPor: parsed.data.nome, recusaMotivo: parsed.data.motivo, recusadoIp: ip },
  });
  if (r.count !== 1) return NextResponse.json({ erro: "Este orçamento não está disponível para resposta" }, { status: 400 });
  await registrarEvento({ empresaId: orcamento.empresaId, orcamentoId: orcamento.id, tipo: "RECUSADO", detalhe: `${parsed.data.nome}: ${parsed.data.motivo}`, ip });
  await avisarResponsavel(orcamento.id, "RECUSADO");

  return NextResponse.json({ ok: true, status: "REPROVADO" });
}
