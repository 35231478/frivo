import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tecnicoSchema } from "@/lib/validations";
import { exigirPermissao } from "@/lib/permissoes-server";

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
      veiculoId: true,
    },
  });

  return NextResponse.json(tecnicos);
}

export async function POST(req: NextRequest) {
  // Cadastrar colaborador (inclusive pelo cadastro rápido) exige "Equipes / Colaboradores › gerenciar"
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

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

  const { competenciaIds, documentos, dataNascimento, dataAdmissao, cargoId, perfilAcessoId, email, veiculoId, ...rest } = parsed.data;
  // Veículo padrão (opcional) precisa ser da mesma empresa
  if (veiculoId && !(await prisma.veiculo.findFirst({ where: { id: veiculoId, empresaId }, select: { id: true } })))
    return NextResponse.json({ erro: "Veículo inválido." }, { status: 400 });

  const tecnico = await prisma.tecnico.create({
    data: {
      ...rest,
      empresaId,
      email: email || null,
      cargoId: cargoId || null,
      perfilAcessoId: perfilAcessoId || null,
      veiculoId: veiculoId || null,
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

  // Salário só pela seção de folha (financeiro.folha): não volta na resposta do cadastro geral
  const { salario: _, ...resposta } = tecnico;
  return NextResponse.json(resposta, { status: 201 });
}
