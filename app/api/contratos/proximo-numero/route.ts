import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";

/** Retorna o próximo número de contrato sugerido (CT-AAAA-NNN), incrementando o maior do ano. */
export async function GET(_: NextRequest) {
  const guard = await exigirPermissao("contratos", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
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
