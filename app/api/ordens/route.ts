import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ErroTecnicos, MSG_SEM_EXECUTOR, gravarTecnicos, lerDefinicao, lerVeiculo, resolverTecnicos, resolverVeiculo } from "@/lib/atividade-tecnicos";

const osCreateSchema = z.object({
  clienteId: z.string().min(1),
  unidadeId: z.string().optional(),
  contratoId: z.string().optional(),
  prioridade: z.string().default("NORMAL"),
  descricao: z.string().min(5),
  previsaoConclusao: z.string().optional(),
  observacoes: z.string().optional(),
});

/** 1ª atividade da OS — é nela que fica QUEM EXECUTA (obrigatório) e o veículo. */
const execucaoSchema = z.object({
  titulo: z.string().optional(),
  tipoOsId: z.string().optional().nullable(),
  dataAgendada: z.string().optional().nullable(),
  duracaoMin: z.number().int().positive().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const prioridade = searchParams.get("prioridade");
  const clienteId = searchParams.get("clienteId");
  const origem = searchParams.get("origem");
  const busca = searchParams.get("busca") ?? "";

  const where: any = { empresaId };
  if (status) where.status = status;
  if (prioridade) where.prioridade = prioridade;
  if (clienteId) where.clienteId = clienteId;
  if (origem) where.origem = origem;
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { descricao: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const ordens = await prisma.ordemServico.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      unidade: { select: { id: true, nome: true } },
      responsavel: { select: { id: true, nome: true } },
      _count: { select: { atividades: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });

  return NextResponse.json(ordens);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("ordens", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json();
  const parsed = osCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  // Quem executa é obrigatório ao abrir a OS: equipe OU colaboradores (+ veículo puxado/escolhido)
  const exec = body?.execucao;
  const execParsed = execucaoSchema.safeParse(exec ?? {});
  const def = lerDefinicao(exec);
  if (!exec || !execParsed.success || !def) return NextResponse.json({ erro: MSG_SEM_EXECUTOR }, { status: 400 });
  const tipoOsId = execParsed.data.tipoOsId || null;
  const tipoOs = tipoOsId ? await prisma.tipoOs.findFirst({ where: { id: tipoOsId, empresaId }, select: { id: true, nome: true } }) : null;
  if (tipoOsId && !tipoOs) return NextResponse.json({ erro: "Tipo de OS inválido." }, { status: 400 });
  const dataAgendada = execParsed.data.dataAgendada ? new Date(execParsed.data.dataAgendada) : null;
  if (dataAgendada && Number.isNaN(dataAgendada.getTime())) return NextResponse.json({ erro: "Data agendada inválida." }, { status: 400 });
  let tecnicos: Awaited<ReturnType<typeof resolverTecnicos>>;
  let veiculoId: string | null;
  try {
    tecnicos = await resolverTecnicos(empresaId, def, tipoOsId, { exigir: true });
    veiculoId = await resolverVeiculo(empresaId, lerVeiculo(exec), tecnicos);
  } catch (e) { if (e instanceof ErroTecnicos) return NextResponse.json({ erro: e.message }, { status: 400 }); throw e; }
  // Cliente/endereço/contrato da mesma empresa
  if (!(await prisma.cliente.findFirst({ where: { id: parsed.data.clienteId, empresaId }, select: { id: true } })))
    return NextResponse.json({ erro: "Cliente inválido." }, { status: 400 });

  const ano = new Date().getFullYear();
  const ultimaOs = await prisma.ordemServico.findFirst({
    where: { empresaId, numero: { startsWith: `OS-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = (ultimaOs ? Number(ultimaOs.numero.split("-")[2]) : 0) + 1;
  const numero = `OS-${ano}-${String(seq).padStart(4, "0")}`;

  const os = await prisma.$transaction(async (tx) => {
   const criada = await tx.ordemServico.create({
    data: {
      empresaId,
      numero,
      clienteId: parsed.data.clienteId,
      unidadeId: parsed.data.unidadeId || null,
      contratoId: parsed.data.contratoId || null,
      responsavelId: usuarioId,
      criadoPorId: usuarioId,
      prioridade: parsed.data.prioridade as any,
      status: "ABERTA",
      descricao: parsed.data.descricao,
      previsaoConclusao: parsed.data.previsaoConclusao ? new Date(parsed.data.previsaoConclusao) : null,
      observacoes: parsed.data.observacoes || null,
    },
   });
   const atividade = await tx.atividadeOs.create({
    data: {
      empresaId, ordemServicoId: criada.id, tipoOsId,
      titulo: execParsed.data.titulo?.trim() || tipoOs?.nome || "Atendimento",
      tecnicoId: tecnicos.responsavel, veiculoId, dataAgendada, duracaoMin: execParsed.data.duracaoMin ?? null,
      status: "AGENDADA",
    },
    select: { id: true },
   });
   await gravarTecnicos(tx, atividade.id, tecnicos);
   await tx.osHistorico.create({
    data: { ordemServicoId: criada.id, usuarioId, acao: "OS criada", detalhes: `Ordem de serviço ${numero} criada.` },
   });
   return criada;
  });

  return NextResponse.json(os, { status: 201 });
}
