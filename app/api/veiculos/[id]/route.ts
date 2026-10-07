import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { veiculoSchema } from "@/lib/validations";
import { organizarFotosVeiculo } from "@/lib/veiculo-fotos";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { lerMotivo } from "@/lib/inativacao-server";
import { inativarVeiculo, reativarVeiculo, statusHttp } from "@/lib/acoes-massa/regras";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const veiculo = await prisma.veiculo.findFirst({
    where: { id, empresaId },
    include: {
      documentos: { orderBy: { criadoEm: "asc" } },
      manutencoes: { orderBy: { dataRealizacao: "desc" } },
    },
  });
  if (!veiculo) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(veiculo);
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Cadastrar/editar veículo exige "veiculos.gerenciar" (antes bastava estar logado)
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.veiculo.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = veiculoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const placa = parsed.data.placa.toUpperCase().trim();
  if (placa !== existente.placa) {
    const dup = await prisma.veiculo.findFirst({ where: { empresaId, placa } });
    if (dup) return NextResponse.json({ erro: "Placa já cadastrada" }, { status: 409 });
  }

  const { documentos, responsavelId, equipeId, proximaRevisaoData, seguroVencimento, fotos: fotosBrutas, fotosRotulos: rotulosBrutos, ...rest } = parsed.data;
  // Frente primeiro (capa), depois traseira, laterais e outros
  const { fotos, fotosRotulos } = organizarFotosVeiculo(fotosBrutas, rotulosBrutos);
  // Inativar pelo formulário (status) segue a mesma regra do botão: exige "excluir"
  if (rest.status === "INATIVO" && existente.status !== "INATIVO" && !pode(session.user!.permissoes, "veiculos", "excluir", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão para inativar veículos" }, { status: 403 });

  const veiculo = await prisma.veiculo.update({
    where: { id },
    data: {
      ...rest,
      fotos,
      fotosRotulos,
      placa,
      responsavelId: responsavelId || null,
      equipeId: equipeId || null,
      proximaRevisaoData: proximaRevisaoData ? new Date(proximaRevisaoData) : null,
      seguroVencimento: seguroVencimento ? new Date(seguroVencimento) : null,
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

  return NextResponse.json(veiculo);
}

/**
 * Inativa o veículo — soft-delete (status INATIVO). Antes era exclusão física, que
 * apagava junto (cascade) checklists, manutenções e documentos. Body opcional: { motivo }.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const motivo = lerMotivo(await req.json().catch(() => ({})));
  // Mesma regra da ação em massa (lib/acoes-massa/regras.ts)
  const r = await inativarVeiculo(id, { empresaId, usuarioId: session.user!.id, usuarioNome: session.user!.name ?? "usuário", motivo });
  if (!r.ok) return NextResponse.json({ erro: r.codigo === "nao_encontrado" ? "Não encontrado" : r.motivo }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true });
}

/** Reativa o veículo (status ATIVO). Exige "gerenciar". Body: { ativo: true } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  if ((await req.json().catch(() => ({})))?.ativo !== true) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });

  const r = await reativarVeiculo(id, { empresaId, usuarioId: guard.session.user!.id, usuarioNome: guard.session.user!.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: "Não encontrado" }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true });
}
