import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const aliquota = z.preprocess(
  (v) => (v === "" || v == null || (typeof v === "number" && isNaN(v)) ? null : Number(v)),
  z.number().nonnegative().nullable()
);
const textoFiscal = z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  z.string().nullable()
);

const schema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  unidade: z.string().default("un"),
  valorPadrao: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && isNaN(v)) ? null : Number(v)),
    z.number().nullable()
  ).optional(),
  codigoMunicipal: textoFiscal.optional(),
  codigoLc116: textoFiscal.optional(),
  aliquotaISS: aliquota.optional(),
  aliquotaPIS: aliquota.optional(),
  aliquotaCOFINS: aliquota.optional(),
  aliquotaCSLL: aliquota.optional(),
  aliquotaIR: aliquota.optional(),
  observacaoFiscal: textoFiscal.optional(),
  ativo: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const servicos = await prisma.servico.findMany({
    where: { empresaId: session.user!.empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(servicos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const item = await prisma.servico.create({
    data: { ...parsed.data, valorPadrao: parsed.data.valorPadrao ?? null, empresaId: session.user!.empresaId },
  });
  return NextResponse.json(item, { status: 201 });
}
