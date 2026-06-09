import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarQrDataUrl } from "@/lib/portal-server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

function urlPublica(token: string) {
  const base = process.env.NEXTAUTH_URL || "";
  return `${base}/qr/${token}`;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const qrcode = await prisma.qrcode.findFirst({
    where: { id, empresaId },
    include: {
      equipamento: { select: { id: true, marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true } } } },
    },
  });
  if (!qrcode) return NextResponse.json({ erro: "QR Code não encontrado" }, { status: 404 });

  const url = urlPublica(qrcode.tokenPublico);
  const imagem = await gerarQrDataUrl(url);

  return NextResponse.json({ ...qrcode, urlPublica: url, imagem });
}

const patchSchema = z.object({
  equipamentoId: z.string().nullable().optional(),
  ativo: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.qrcode.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "QR Code não encontrado" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const dados: any = {};

  if (typeof d.ativo === "boolean") dados.ativo = d.ativo;

  if (d.equipamentoId !== undefined) {
    if (d.equipamentoId === null || d.equipamentoId === "") {
      dados.equipamentoId = null;
    } else {
      // Equipamento precisa ser da empresa e não estar vinculado a outro QR
      const equip = await prisma.equipamento.findFirst({
        where: { id: d.equipamentoId, empresaId },
        include: { qrcode: { select: { id: true } } },
      });
      if (!equip) return NextResponse.json({ erro: "Equipamento inválido" }, { status: 400 });
      if (equip.qrcode && equip.qrcode.id !== id) {
        return NextResponse.json({ erro: "Este equipamento já possui um QR Code vinculado." }, { status: 400 });
      }
      dados.equipamentoId = d.equipamentoId;
    }
  }

  const qrcode = await prisma.qrcode.update({ where: { id }, data: dados });
  return NextResponse.json(qrcode);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.qrcode.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "QR Code não encontrado" }, { status: 404 });

  await prisma.qrcode.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
