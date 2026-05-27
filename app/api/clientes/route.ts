import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clienteSchema } from "@/lib/validations";
import { z } from "zod";

const unidadeInlineSchema = z.object({
  nome: z.string().min(1),
  principal: z.boolean().default(false),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  telefone: z.string().optional(),
  observacoes: z.string().optional(),
});

const anexoInlineSchema = z.object({
  nome: z.string().min(1),
  tipo: z.string().min(1),
  tamanho: z.number(),
  conteudo: z.string().min(1),
});

const contatoInlineSchema = z.object({
  nome: z.string().min(1),
  cargo: z.string().optional(),
  tipo: z.string().default("OUTRO"),
  telefone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().optional(),
  principal: z.boolean().default(false),
});

const clienteComUnidadesSchema = clienteSchema.extend({
  unidades: z.array(unidadeInlineSchema).optional(),
  anexos: z.array(anexoInlineSchema).optional(),
  contatos: z.array(contatoInlineSchema).optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const busca = searchParams.get("busca") ?? "";

  const clientes = await prisma.cliente.findMany({
    where: {
      empresaId,
      ativo: true,
      ...(busca && {
        OR: [
          { nome: { contains: busca, mode: "insensitive" } },
          { cpfCnpj: { contains: busca } },
        ],
      }),
    },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, nomeFantasia: true, cpfCnpj: true, telefone: true, cidade: true },
  });

  return NextResponse.json(clientes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = clienteComUnidadesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const existente = await prisma.cliente.findUnique({
    where: { cpfCnpj_empresaId: { cpfCnpj: parsed.data.cpfCnpj, empresaId } },
  });
  if (existente) return NextResponse.json({ erro: "CPF/CNPJ já cadastrado" }, { status: 409 });

  const { responsavelTecnicoId, unidades, anexos, contatos, ...resto } = parsed.data;

  const cliente = await prisma.cliente.create({
    data: {
      ...resto,
      empresaId,
      responsavelTecnicoId: responsavelTecnicoId || null,
      unidades: unidades && unidades.length > 0
        ? {
            create: unidades.map((u) => ({
              ...u,
              empresaId,
              latitude: u.latitude ?? null,
              longitude: u.longitude ?? null,
            })),
          }
        : undefined,
      anexos: anexos && anexos.length > 0
        ? {
            create: anexos.map((a) => ({ ...a, empresaId })),
          }
        : undefined,
      contatosCliente: contatos && contatos.length > 0
        ? {
            create: contatos.map((c) => ({
              ...c,
              tipo: c.tipo as any,
              empresaId,
            })),
          }
        : undefined,
    },
    include: { unidades: true },
  });

  return NextResponse.json(cliente, { status: 201 });
}
