import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

const schema = z.object({ valor: z.string().min(1) });

/**
 * Resolve um QR escaneado (URL .../qr/<token>, token puro ou código QR-AAAA-NNNN)
 * para o equipamento e marca o vínculo da atividade como "feito".
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  const atividade = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    select: { id: true },
  });
  if (!atividade) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  // Extrai o token de uma URL .../qr/<token> ou usa o valor cru
  const valor = parsed.data.valor.trim();
  const m = valor.match(/\/qr\/([^/?#\s]+)/);
  const token = m ? m[1] : valor;

  const qrcode = await prisma.qrcode.findFirst({
    where: { empresaId, OR: [{ tokenPublico: token }, { codigo: valor }] },
    select: { equipamentoId: true },
  });
  if (!qrcode?.equipamentoId) {
    return NextResponse.json({ erro: "QR Code não reconhecido." }, { status: 404 });
  }

  const vinculo = await prisma.atividadeEquipamento.findFirst({
    where: { atividadeId, equipamentoId: qrcode.equipamentoId },
    select: { id: true, equipamento: { select: { nome: true, marca: true, modelo: true } } },
  });
  if (!vinculo) {
    const eq = await prisma.equipamento.findUnique({
      where: { id: qrcode.equipamentoId },
      select: { nome: true, marca: true, modelo: true },
    });
    const nome = eq ? `${eq.nome ? `${eq.nome} — ` : ""}${eq.marca} ${eq.modelo}` : "equipamento";
    return NextResponse.json({ erro: `O ${nome} não faz parte desta atividade.` }, { status: 409 });
  }

  const atualizado = await prisma.atividadeEquipamento.update({
    where: { id: vinculo.id },
    data: { feito: true, feitoEm: new Date() },
    select: { id: true, feito: true, equipamentoId: true },
  });

  return NextResponse.json({
    ok: true,
    vinculoId: atualizado.id,
    equipamentoId: atualizado.equipamentoId,
    nome: `${vinculo.equipamento.nome ? `${vinculo.equipamento.nome} — ` : ""}${vinculo.equipamento.marca} ${vinculo.equipamento.modelo}`,
  });
}
