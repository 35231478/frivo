import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const CAMPOS_NUM = ["valorPadrao", "aliquotaISS", "aliquotaPIS", "aliquotaCOFINS", "aliquotaCSLL", "aliquotaIR"];
const CAMPOS_TEXTO = ["codigoMunicipal", "codigoLc116", "observacaoFiscal", "descricao"];

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const body = await req.json();

  // Garante isolamento de tenant
  const existente = await prisma.servico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "id" || k === "empresaId" || k === "criadoEm") continue;
    if (CAMPOS_NUM.includes(k)) {
      data[k] = v === "" || v == null || (typeof v === "number" && isNaN(v)) ? null : Number(v);
    } else if (CAMPOS_TEXTO.includes(k)) {
      data[k] = v === "" || v == null ? null : v;
    } else {
      data[k] = v;
    }
  }

  const item = await prisma.servico.update({ where: { id }, data });
  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  await prisma.servico.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
