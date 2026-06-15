import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clienteSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

async function getClienteTenant(id: string, empresaId: string) {
  return prisma.cliente.findFirst({ where: { id, empresaId } });
}

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({
    where: { id, empresaId },
    include: {
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      unidades: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      contatosCliente: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      interacoes: { include: { usuario: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "desc" }, take: 50 },
      _count: { select: { contratos: true } },
    },
  });
  if (!cliente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(cliente);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await getClienteTenant(id, empresaId);
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = clienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.cpfCnpj !== existente.cpfCnpj) {
    const dup = await prisma.cliente.findUnique({
      where: { cpfCnpj_empresaId: { cpfCnpj: parsed.data.cpfCnpj, empresaId } },
    });
    if (dup) return NextResponse.json({ erro: "CPF/CNPJ já cadastrado" }, { status: 409 });
  }

  const { responsavelTecnicoId, segmento, origem, satisfacao, ...resto } = parsed.data;

  const atualizado = await prisma.cliente.update({
    where: { id },
    data: {
      ...resto,
      responsavelTecnicoId: responsavelTecnicoId || null,
      segmento: segmento || null,
      origem: origem || null,
      satisfacao: satisfacao ?? null,
    },
  });
  return NextResponse.json(atualizado);
}

// Alteração pontual de status (ativo/inativo) sem mexer no restante do cadastro.
// Inativar é um soft-delete: apenas `ativo` muda; todo o histórico é preservado.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await getClienteTenant(id, empresaId);
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.ativo !== "boolean") {
    return NextResponse.json({ erro: "Campo 'ativo' (boolean) é obrigatório." }, { status: 400 });
  }

  const atualizado = await prisma.cliente.update({ where: { id }, data: { ativo: body.ativo } });
  return NextResponse.json({ ok: true, ativo: atualizado.ativo });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await getClienteTenant(id, empresaId);
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.cliente.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
