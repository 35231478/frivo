import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { haversine } from "@/lib/geo";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ erro: "Parâmetros lat e lng são obrigatórios." }, { status: 400 });
  }

  const tecnicos = await prisma.tecnico.findMany({
    where: {
      empresaId,
      ativo: true,
      tipo: "TECNICO_CAMPO",
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true, nome: true, telefone: true,
      latitude: true, longitude: true,
      ultimaLocalizacao: true,
      especialidades: true,
    },
  });

  const comDistancia = tecnicos
    .map((t) => ({
      ...t,
      distanciaKm: haversine(lat, lng, t.latitude!, t.longitude!),
    }))
    .sort((a, b) => a.distanciaKm - b.distanciaKm);

  return NextResponse.json(comDistancia);
}
