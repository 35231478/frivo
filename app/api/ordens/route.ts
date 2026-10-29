import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { equipamentosDoCliente } from "@/lib/execucao/vinculos";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { criarPrimeiraAtividade, prepararExecucao, proximoNumeroOs } from "@/lib/os/abertura";

const osCreateSchema = z.object({
  clienteId: z.string().min(1),
  unidadeId: z.string().optional(),
  contratoId: z.string().optional(),
  prioridade: z.string().default("NORMAL"),
  descricao: z.string().min(5),
  previsaoConclusao: z.string().optional(),
  observacoes: z.string().optional(),
  /** Equipamentos atendidos já na abertura (opcional; dá para vincular depois, na execução) */
  equipamentoIds: z.array(z.string().min(1)).max(200).optional(),
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
  const prep = await prepararExecucao(empresaId, body?.execucao);
  if ("erro" in prep) return NextResponse.json({ erro: prep.erro }, { status: 400 });
  // Cliente/endereço/contrato da mesma empresa
  if (!(await prisma.cliente.findFirst({ where: { id: parsed.data.clienteId, empresaId }, select: { id: true } })))
    return NextResponse.json({ erro: "Cliente inválido." }, { status: 400 });
  // Equipamentos atendidos (opcional): só do cliente da OS e ativos
  let equipamentoIds: string[] = [];
  if (parsed.data.equipamentoIds?.length) {
    const r = await equipamentosDoCliente(empresaId, parsed.data.clienteId, parsed.data.equipamentoIds);
    if (r.erro) return NextResponse.json({ erro: r.erro }, { status: 400 });
    equipamentoIds = r.validos;
  }

  const numero = await proximoNumeroOs(empresaId);

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
   const atividadeId = await criarPrimeiraAtividade(tx, empresaId, criada.id, prep.execucao);
   if (equipamentoIds.length) await tx.atividadeEquipamento.createMany({ data: equipamentoIds.map((equipamentoId) => ({ atividadeId, equipamentoId })) });
   await tx.osHistorico.create({
    data: { ordemServicoId: criada.id, usuarioId, acao: "OS criada", detalhes: `Ordem de serviço ${numero} criada.` },
   });
   return criada;
  });

  // Central da OS: a 1ª atividade agendada com data já põe a OS em "Agendada"
  await sincronizarStatusOs(os.id, empresaId, usuarioId);
  return NextResponse.json(os, { status: 201 });
}
