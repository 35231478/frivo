import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const gerarSchema = z.object({
  quantidade: z.number().int().min(1).max(100),
});

/** Próximo número sequencial QR-AAAA-#### para a empresa. */
async function proximoSequencial(empresaId: string, ano: number) {
  const ultimo = await prisma.qrcode.findFirst({
    where: { empresaId, codigo: { startsWith: `QR-${ano}-` } },
    orderBy: { codigo: "desc" },
    select: { codigo: true },
  });
  return ultimo ? Number(ultimo.codigo.split("-")[2]) + 1 : 1;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const { searchParams } = new URL(req.url);
  const vinculado = searchParams.get("vinculado"); // "true" | "false" | null
  const ativo = searchParams.get("ativo"); // "true" | "false" | null

  const where: any = { empresaId };
  if (vinculado === "true") where.equipamentoId = { not: null };
  if (vinculado === "false") where.equipamentoId = null;
  if (ativo === "true") where.ativo = true;
  if (ativo === "false") where.ativo = false;

  const qrcodes = await prisma.qrcode.findMany({
    where,
    include: {
      equipamento: { select: { id: true, marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true } } } },
    },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(qrcodes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const parsed = gerarSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const ano = new Date().getFullYear();
  const inicio = await proximoSequencial(empresaId, ano);

  const dados = Array.from({ length: parsed.data.quantidade }, (_, i) => ({
    empresaId,
    codigo: `QR-${ano}-${String(inicio + i).padStart(4, "0")}`,
  }));

  await prisma.qrcode.createMany({ data: dados });

  const criados = await prisma.qrcode.findMany({
    where: { empresaId, codigo: { in: dados.map((d) => d.codigo) } },
    orderBy: { codigo: "asc" },
  });

  return NextResponse.json(criados, { status: 201 });
}
