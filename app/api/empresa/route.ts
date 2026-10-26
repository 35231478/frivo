import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const textoBanco = (max: number) =>
  z.string().trim().max(max).transform((v) => v || null).optional().nullable();

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
  // Dados bancários (saem no orçamento do cliente). Vazio = sem o campo.
  bancoNome: textoBanco(80),
  bancoAgencia: textoBanco(20),
  bancoConta: textoBanco(30),
  bancoTipoConta: textoBanco(30),
  bancoTitular: textoBanco(120),
  pixChave: textoBanco(120),
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
      bancoNome: true, bancoAgencia: true, bancoConta: true, bancoTipoConta: true, bancoTitular: true, pixChave: true,
      plano: true,
    },
  });

  return NextResponse.json(empresa);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  // Permissão, não role: quem tem "Configurações > Gerenciar" no perfil também pode (I5)
  if (!pode(session.user!.permissoes, "configuracoes", "gerenciar", session.user!.role)) {
    return NextResponse.json({ erro: "Sem permissão para alterar configurações." }, { status: 403 });
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
