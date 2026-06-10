import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tecnicoSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo");
  const tipoOsId = searchParams.get("tipoOsId");

  const tecnicos = await prisma.tecnico.findMany({
    where: {
      empresaId,
      ativo: true,
      ...(tipo && { tipo: tipo as any }),
      ...(tipoOsId && { competencias: { some: { id: tipoOsId } } }),
    },
    orderBy: { nome: "asc" },
    select: {
      id: true, nome: true, telefone: true, especialidades: true, tipo: true, crea: true, avatar: true,
      competencias: { select: { id: true } },
    },
  });

  return NextResponse.json(tecnicos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = tecnicoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const existente = await prisma.tecnico.findUnique({
    where: { cpf_empresaId: { cpf: parsed.data.cpf, empresaId } },
  });
  if (existente) return NextResponse.json({ erro: "CPF já cadastrado" }, { status: 409 });

  const { competenciaIds, documentos, dataNascimento, dataAdmissao, cargoId, perfilAcessoId, email, ...rest } = parsed.data;

  const tecnico = await prisma.tecnico.create({
    data: {
      ...rest,
      empresaId,
      email: email || null,
      cargoId: cargoId || null,
      perfilAcessoId: perfilAcessoId || null,
      dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
      dataAdmissao: dataAdmissao ? new Date(dataAdmissao) : null,
      competencias: { connect: competenciaIds.map((id) => ({ id })) },
      documentos: {
        create: documentos.map((d) => ({
          tipo: d.tipo,
          nome: d.nome,
          arquivoUrl: d.arquivoUrl || null,
          dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
        })),
      },
    },
  });

  return NextResponse.json(tecnico, { status: 201 });
}
