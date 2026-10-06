import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const locSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
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
