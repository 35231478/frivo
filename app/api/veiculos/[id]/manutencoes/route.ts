import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { veiculoManutencaoSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  // Registrar/remover manutenção altera o cadastro do veículo: exige "veiculos.gerenciar"
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const veiculo = await prisma.veiculo.findFirst({ where: { id, empresaId } });
  if (!veiculo) return NextResponse.json({ erro: "Veículo não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = veiculoManutencaoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { dataRealizacao, proximaData, anexoUrl, ...rest } = parsed.data;

  const manutencao = await prisma.veiculoManutencao.create({
    data: {
      ...rest,
      veiculoId: id,
      dataRealizacao: new Date(dataRealizacao),
      proximaData: proximaData ? new Date(proximaData) : null,
      anexoUrl: anexoUrl || null,
    },
  });

  // Atualiza a próxima revisão do veículo quando informada
  if (parsed.data.proximaData || parsed.data.proximaKm != null) {
    await prisma.veiculo.update({
      where: { id },
      data: {
        proximaRevisaoData: parsed.data.proximaData ? new Date(parsed.data.proximaData) : veiculo.proximaRevisaoData,
        proximaRevisaoKm: parsed.data.proximaKm ?? veiculo.proximaRevisaoKm,
      },
    });
  }

  return NextResponse.json(manutencao, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  // Registrar/remover manutenção altera o cadastro do veículo: exige "veiculos.gerenciar"
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const manutencaoId = searchParams.get("manutencaoId");
  if (!manutencaoId) return NextResponse.json({ erro: "manutencaoId obrigatório" }, { status: 400 });

  const veiculo = await prisma.veiculo.findFirst({ where: { id, empresaId } });
  if (!veiculo) return NextResponse.json({ erro: "Veículo não encontrado" }, { status: 404 });

  await prisma.veiculoManutencao.deleteMany({ where: { id: manutencaoId, veiculoId: id } });
  return NextResponse.json({ ok: true });
}
