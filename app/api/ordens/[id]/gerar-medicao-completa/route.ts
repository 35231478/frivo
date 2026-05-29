import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarNumeroRelatorio } from "@/lib/utils";
import { criarMedicaoDeRelatorio } from "@/lib/financeiro-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Gera o documento integrado Medição + Relatório a partir da OS.
 * Cria (idempotente) um relatório de escopo MEDICAO_COMPLETA e a medição
 * financeira vinculada (status conforme o perfil do cliente).
 * Retorna o token público da medição para abrir /medicao/[token].
 */
export async function POST(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: {
      contrato: { select: { valorMensal: true } },
      itensOrcamento: true,
      relatorios: { where: { escopo: "MEDICAO_COMPLETA" }, include: { medicao: { select: { tokenPublico: true } } } },
    },
  });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  // Idempotente: já existe documento de medição completa com medição vinculada
  const existente = os.relatorios.find((r) => r.medicao?.tokenPublico);
  if (existente?.medicao?.tokenPublico) {
    return NextResponse.json({ ok: true, medicaoToken: existente.medicao.tokenPublico, jaExistia: true });
  }

  const ref = os.dataConclusao ?? new Date();
  const valor = os.contrato?.valorMensal
    ? Number(os.contrato.valorMensal)
    : os.itensOrcamento.reduce((acc, it) => acc + Number(it.valorTotal), 0);

  // Reaproveita um relatório MEDICAO_COMPLETA existente sem medição, ou cria um novo
  let relatorioId: string | null = os.relatorios.find((r) => !r.medicaoId)?.id ?? null;
  if (!relatorioId) {
    const seq = (await prisma.relatorioOs.count({ where: { empresaId } })) + 1;
    const novo = await prisma.relatorioOs.create({
      data: {
        empresaId,
        ordemServicoId: os.id,
        contratoId: os.contratoId,
        numero: gerarNumeroRelatorio(seq, ref.getFullYear()),
        tipo: "MEDICAO",
        escopo: "MEDICAO_COMPLETA",
        mesReferencia: ref.getMonth() + 1,
        anoReferencia: ref.getFullYear(),
        valorFinanceiro: valor,
        status: "RASCUNHO",
        tokenPublico: crypto.randomUUID(),
      },
    });
    relatorioId = novo.id;
  }

  const medicao = await criarMedicaoDeRelatorio(relatorioId);
  if (!medicao) return NextResponse.json({ erro: "Falha ao gerar medição" }, { status: 500 });

  return NextResponse.json({ ok: true, medicaoToken: medicao.tokenPublico, jaExistia: false }, { status: 201 });
}
