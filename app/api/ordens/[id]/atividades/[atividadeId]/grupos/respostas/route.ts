import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

const schema = z.object({
  tipoEquipamentoId: z.string().min(1),
  formularioId: z.string().min(1),
  respostas: z.array(z.object({
    campoId: z.string().min(1),
    resposta: z.string().nullable().optional(),
    arquivoUrl: z.string().nullable().optional(),
  })),
});

/**
 * Grava a resposta do formulário de UM grupo (tipo de equipamento) e REPLICA as
 * respostas para todos os equipamentos do grupo marcados como "feito".
 * Equipamentos não marcados NÃO recebem respostas.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  const atividade = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    select: { id: true, tipoOsId: true, tecnicoId: true },
  });
  if (!atividade) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  if (!atividade.tipoOsId) return NextResponse.json({ erro: "Atividade sem tipo de OS." }, { status: 400 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const { tipoEquipamentoId, formularioId, respostas } = parsed.data;

  // Confirma que o formulário é realmente o vinculado a (tipoEquipamento + tipoOs)
  const mapping = await prisma.formTypeMapping.findFirst({
    where: { empresaId, tipoOsId: atividade.tipoOsId, tipoEquipamentoId, formularioTemplateId: formularioId },
    select: { id: true },
  });
  if (!mapping) {
    return NextResponse.json({ erro: "Formulário não corresponde a este tipo de equipamento/OS." }, { status: 400 });
  }

  // Equipamentos do grupo marcados como feito
  const alvos = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId, feito: true, equipamento: { tipoEquipamentoId } },
    select: { equipamentoId: true },
  });
  if (alvos.length === 0) {
    return NextResponse.json({ erro: "Nenhum equipamento marcado como feito neste grupo." }, { status: 400 });
  }

  // Valida que os campos pertencem ao formulário
  const camposValidos = new Set(
    (await prisma.formularioCampo.findMany({ where: { formularioId }, select: { id: true } })).map((c) => c.id),
  );
  const limpos = respostas.filter((r) => camposValidos.has(r.campoId));

  // Replica: persiste UMA linha por (equipamento × campo) — preenchido uma vez, salvo por equipamento
  const agora = new Date();
  await prisma.$transaction(
    alvos.flatMap((alvo) =>
      limpos.map((r) =>
        prisma.respostaFormularioEquipamento.upsert({
          where: {
            atividadeId_equipamentoId_campoId: {
              atividadeId,
              equipamentoId: alvo.equipamentoId,
              campoId: r.campoId,
            },
          },
          create: {
            empresaId,
            atividadeId,
            equipamentoId: alvo.equipamentoId,
            formularioId,
            campoId: r.campoId,
            resposta: r.resposta ?? null,
            arquivoUrl: r.arquivoUrl ?? null,
            respondidoPorId: atividade.tecnicoId,
            respondidoEm: agora,
          },
          update: {
            resposta: r.resposta ?? null,
            arquivoUrl: r.arquivoUrl ?? null,
            respondidoPorId: atividade.tecnicoId,
            respondidoEm: agora,
          },
        }),
      ),
    ),
  );

  return NextResponse.json({ ok: true, equipamentosAtualizados: alvos.length, camposPorEquipamento: limpos.length });
}
