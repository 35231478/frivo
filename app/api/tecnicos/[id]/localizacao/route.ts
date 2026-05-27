import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const locSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const tecnico = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!tecnico) return NextResponse.json({ erro: "Técnico não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = locSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Coordenadas inválidas" }, { status: 400 });
  }

  const atualizado = await prisma.tecnico.update({
    where: { id },
    data: {
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      ultimaLocalizacao: new Date(),
    },
    select: { id: true, nome: true, latitude: true, longitude: true, ultimaLocalizacao: true },
  });

  return NextResponse.json(atualizado);
}
