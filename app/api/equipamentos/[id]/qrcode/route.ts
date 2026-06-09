import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const postSchema = z.object({
  qrcodeId: z.string().optional(),
});

async function proximoSequencial(empresaId: string, ano: number) {
  const ultimo = await prisma.qrcode.findFirst({
    where: { empresaId, codigo: { startsWith: `QR-${ano}-` } },
    orderBy: { codigo: "desc" },
    select: { codigo: true },
  });
  return ultimo ? Number(ultimo.codigo.split("-")[2]) + 1 : 1;
}

/** Gera um novo QR Code já vinculado ao equipamento, OU vincula um QR existente. */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const equip = await prisma.equipamento.findFirst({
    where: { id, empresaId },
    include: { qrcode: { select: { id: true } } },
  });
  if (!equip) return NextResponse.json({ erro: "Equipamento não encontrado" }, { status: 404 });
  if (equip.qrcode) return NextResponse.json({ erro: "Equipamento já possui um QR Code vinculado." }, { status: 400 });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  // Vincular um QR existente
  if (parsed.data.qrcodeId) {
    const qr = await prisma.qrcode.findFirst({ where: { id: parsed.data.qrcodeId, empresaId } });
    if (!qr) return NextResponse.json({ erro: "QR Code inválido" }, { status: 400 });
    if (qr.equipamentoId) return NextResponse.json({ erro: "Este QR Code já está vinculado." }, { status: 400 });
    const atualizado = await prisma.qrcode.update({ where: { id: qr.id }, data: { equipamentoId: id } });
    return NextResponse.json(atualizado, { status: 200 });
  }

  // Gerar um novo QR e vincular
  const ano = new Date().getFullYear();
  const seq = await proximoSequencial(empresaId, ano);
  const novo = await prisma.qrcode.create({
    data: { empresaId, codigo: `QR-${ano}-${String(seq).padStart(4, "0")}`, equipamentoId: id },
  });
  return NextResponse.json(novo, { status: 201 });
}

/** Desvincula o QR Code do equipamento (mantém o QR no acervo). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const qr = await prisma.qrcode.findFirst({ where: { equipamentoId: id, empresaId } });
  if (!qr) return NextResponse.json({ erro: "Nenhum QR Code vinculado" }, { status: 404 });

  await prisma.qrcode.update({ where: { id: qr.id }, data: { equipamentoId: null } });
  return NextResponse.json({ ok: true });
}
