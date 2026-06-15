import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Retorna o próximo número de contrato sugerido (CT-AAAA-NNN), incrementando o maior do ano. */
export async function GET(_: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const ano = new Date().getFullYear();
  const ultimo = await prisma.contrato.findFirst({
    where: { empresaId, numero: { startsWith: `CT-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });

  const ultimaSeq = ultimo ? Number(ultimo.numero.split("-")[2]) : 0;
  const seq = Number.isFinite(ultimaSeq) ? ultimaSeq + 1 : 1;
  const numero = `CT-${ano}-${String(seq).padStart(3, "0")}`;

  return NextResponse.json({ numero });
}
