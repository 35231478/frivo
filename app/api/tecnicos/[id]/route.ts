import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tecnicoSchema } from "@/lib/validations";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { impactoColaborador, anotarInativacao, lerMotivo } from "@/lib/inativacao-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  // Ficha completa (CPF/RG, documentos): só quem gerencia colaboradores. O salário só vai junto
  // para quem tem "Financeiro › Custo de pessoal". Seletores de técnico usam GET /api/tecnicos.
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = (session.user as any).empresaId as string;

  const tecnico = await prisma.tecnico.findFirst({
    where: { id, empresaId },
    include: {
      competencias: { select: { id: true } },
      documentos: { orderBy: { criadoEm: "asc" } },
    },
  });
  if (!tecnico) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(semSalario(tecnico, session));
}

/** Remove o salário da resposta para quem não tem a permissão de folha. */
function semSalario<T extends { salario?: unknown }>(t: T, session: { user?: { permissoes?: any; role?: string } | null }) {
  if (pode(session.user?.permissoes, "financeiro", "folha", session.user?.role)) return t;
  const { salario: _, ...resto } = t;
  return resto;
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Editar colaborador exige "Equipes / Colaboradores › gerenciar" (antes bastava estar logado)
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = (session.user as any).empresaId as string;

  const existente = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = tecnicoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.cpf !== existente.cpf) {
    const dup = await prisma.tecnico.findUnique({
      where: { cpf_empresaId: { cpf: parsed.data.cpf, empresaId } },
    });
    if (dup) return NextResponse.json({ erro: "CPF já cadastrado" }, { status: 409 });
  }

  const { competenciaIds, documentos, dataNascimento, dataAdmissao, cargoId, perfilAcessoId, email, veiculoId, ...rest } = parsed.data;
  // Veículo padrão (opcional): só muda quando enviado; precisa ser da mesma empresa
  if (veiculoId && !(await prisma.veiculo.findFirst({ where: { id: veiculoId, empresaId }, select: { id: true } })))
    return NextResponse.json({ erro: "Veículo inválido." }, { status: 400 });
  // Status "Inativo" no formulário = inativar o colaborador (mesma regra do botão: exige "excluir").
  // Mantém `ativo` em sincronia com o status (antes o status mudava, mas ele seguia nas listas).
  let ativo = existente.ativo;
  if (rest.statusColaborador === "INATIVO" && existente.statusColaborador !== "INATIVO") {
    if (!pode(session.user!.permissoes, "equipes", "excluir", session.user!.role))
      return NextResponse.json({ erro: "Sem permissão para inativar colaboradores" }, { status: 403 });
    ativo = false;
  } else if (rest.statusColaborador !== "INATIVO" && existente.statusColaborador === "INATIVO") {
    ativo = true;
  }

  const atualizado = await prisma.tecnico.update({
    where: { id },
    data: {
      ...rest,
      ativo,
      email: email || null,
      cargoId: cargoId || null,
      perfilAcessoId: perfilAcessoId || null,
      ...(veiculoId !== undefined && { veiculoId: veiculoId || null }),
      dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
      dataAdmissao: dataAdmissao ? new Date(dataAdmissao) : null,
      competencias: { set: competenciaIds.map((cid) => ({ id: cid })) },
      documentos: {
        deleteMany: {},
        create: documentos.map((d) => ({
          tipo: d.tipo,
          nome: d.nome,
          arquivoUrl: d.arquivoUrl || null,
          dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
        })),
      },
    },
  });
  return NextResponse.json(semSalario(atualizado, session));
}

/**
 * Inativa o colaborador — soft-delete (ativo=false + status INATIVO). Atividades, OS,
 * equipes e histórico ficam preservados; ele sai das listas e dos seletores.
 * Exige "excluir" do módulo Equipes/Colaboradores. Body opcional: { motivo }.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (!existente.ativo) return NextResponse.json({ ok: true });

  const impacto = await impactoColaborador(id, empresaId);
  if (impacto?.bloqueio) return NextResponse.json({ erro: impacto.bloqueio }, { status: 409 });

  const motivo = lerMotivo(await req.json().catch(() => ({})));
  await prisma.tecnico.update({
    where: { id },
    data: { ativo: false, statusColaborador: "INATIVO", observacoes: anotarInativacao(existente.observacoes, session.user!.name ?? "usuário", motivo) },
  });
  return NextResponse.json({ ok: true });
}

/** Reativa o colaborador (ativo=true + status ATIVO). Exige "gerenciar". Body: { ativo: true } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  if ((await req.json().catch(() => ({})))?.ativo !== true) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });

  const existente = await prisma.tecnico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  await prisma.tecnico.update({ where: { id }, data: { ativo: true, statusColaborador: "ATIVO" } });
  return NextResponse.json({ ok: true });
}
