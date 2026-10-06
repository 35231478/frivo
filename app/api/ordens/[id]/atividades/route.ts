import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ErroTecnicos, INCLUDE_TECNICOS_ATIVIDADE, gravarTecnicos, lerDefinicao, resolverTecnicos } from "@/lib/atividade-tecnicos";

type Params = { params: Promise<{ id: string }> };

const atividadeSchema = z.object({
  titulo: z.string().min(1),
  tipoOsId: z.string().optional(),
  tecnicoId: z.string().optional(),
  dataAgendada: z.string().optional(),
  duracaoMin: z.number().optional(),
  observacao: z.string().optional(),
  status: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: "Ordem de serviço não encontrada" }, { status: 404 });

  const body = await req.json();
  const parsed = atividadeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  // Vários técnicos / equipe: { tecnicoIds, responsavelId?, equipeId? } (o formato antigo, só tecnicoId, continua valendo)
  const def = lerDefinicao(body);
  let tecnicos: Awaited<ReturnType<typeof resolverTecnicos>> | null = null;
  if (def) {
    try { tecnicos = await resolverTecnicos(empresaId, def, parsed.data.tipoOsId || null); }
    catch (e) { if (e instanceof ErroTecnicos) return NextResponse.json({ erro: e.message }, { status: 400 }); throw e; }
  }

  const criada = await prisma.$transaction(async (tx) => {
   const a = await tx.atividadeOs.create({
    data: {
      empresaId,
      ordemServicoId: id,
      titulo: parsed.data.titulo,
      tipoOsId: parsed.data.tipoOsId || null,
      tecnicoId: tecnicos ? tecnicos.responsavel : parsed.data.tecnicoId || null,
      dataAgendada: parsed.data.dataAgendada ? new Date(parsed.data.dataAgendada) : null,
      duracaoMin: parsed.data.duracaoMin ?? null,
      observacao: parsed.data.observacao || null,
    },
    select: { id: true },
   });
   if (tecnicos) await gravarTecnicos(tx, a.id, tecnicos);
   return a;
  });
  const atividade = await prisma.atividadeOs.findUniqueOrThrow({
    where: { id: criada.id },
    include: { tipoOs: { select: { id: true, nome: true, cor: true } }, ...INCLUDE_TECNICOS_ATIVIDADE },
  });

  await prisma.osHistorico.create({
    data: {
      ordemServicoId: id, usuarioId: session.user!.id,
      acao: "Atividade adicionada", detalhes: parsed.data.titulo,
    },
  });

  return NextResponse.json(atividade, { status: 201 });
}
