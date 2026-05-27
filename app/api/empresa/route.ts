import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const empresaUpdateSchema = z.object({
  nome: z.string().min(2).optional(),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  celular: z.string().optional(),
  site: z.string().optional(),
  logo: z.string().optional().nullable(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresa = await prisma.empresa.findUnique({
    where: { id: session.user!.empresaId },
    select: {
      id: true, nome: true, nomeFantasia: true, cnpj: true, email: true,
      telefone: true, celular: true, site: true, logo: true,
      endereco: true, numero: true, complemento: true, bairro: true,
      cidade: true, estado: true, cep: true, latitude: true, longitude: true,
      plano: true,
    },
  });

  return NextResponse.json(empresa);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const role = session.user!.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ erro: "Apenas administradores podem alterar as configurações." }, { status: 403 });
  }

  const body = await req.json();
  const parsed = empresaUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const empresa = await prisma.empresa.update({
    where: { id: session.user!.empresaId },
    data: parsed.data,
  });

  return NextResponse.json(empresa);
}
