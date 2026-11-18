import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { bloqueioPainelTecnico } from "@/lib/tecnico/painel";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { equipamentosDoCliente } from "@/lib/execucao/vinculos";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { criarPrimeiraAtividade, prepararExecucao, proximoNumeroOs } from "@/lib/os/abertura";
import { lerPrazoDigitado, prazoAoCriar } from "@/lib/os/prazo-execucao";
import { fixarLimitesDaOs } from "@/lib/atendimento/prazo-server";

const osCreateSchema = z.object({
  clienteId: z.string().min(1),
  unidadeId: z.string().optional(),
  contratoId: z.string().optional(),
  prioridade: z.string().default("NORMAL"),
  descricao: z.string().min(5),
  /** DATA PREVISTA (agenda). A tela "Nova OS" não manda mais: quem marca o dia é a 1ª atividade. */
  previsaoConclusao: z.string().optional(),
  /** PRAZO DE EXECUÇÃO — o "Prazo para finalizar" (um dia). Vazio = o padrão do tipo de OS, se houver. */
  prazoExecucao: z.string().optional().nullable(),
  /**
   * false = a pessoa viu a sugestão do tipo de OS na tela e a apagou: a OS nasce SEM prazo próprio.
   * Ausente = quem chama não mostrou sugestão (integrações): o padrão do tipo preenche o campo vazio.
   */
  usarPrazoPadrao: z.boolean().optional(),
  /**
   * CHAMADO DO CLIENTE: o cliente pediu este atendimento. A hora da abertura NÃO vem de quem lança —
   * é a do servidor, no momento em que a OS é criada, e não muda depois. Com contrato, é dela que
   * conta o PRAZO DE ATENDIMENTO prometido.
   */
  chamadoDoCliente: z.boolean().optional(),
  observacoes: z.string().optional(),
  /** Equipamentos atendidos já na abertura (opcional; dá para vincular depois, na execução) */
  equipamentoIds: z.array(z.string().min(1)).max(200).optional(),
});

export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  // Lista de OS do PAINEL: bloqueada no modo técnico (o app vê só as OS dele, por /api/tecnico/*).
  const bloqueio = bloqueioPainelTecnico(session);
  if (bloqueio) return bloqueio;
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
  const prazoDigitado = lerPrazoDigitado(parsed.data.prazoExecucao);
  // Chamado do cliente: a abertura é AGORA, pelo relógio do servidor (não se digita nem se edita)
  const chamadoAbertoEm = parsed.data.chamadoDoCliente ? new Date() : null;
  if (prazoDigitado === undefined) return NextResponse.json({ erro: "Prazo para finalizar inválido." }, { status: 400 });

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

  const os = await prisma.$transaction(async (tx) => {
   // Número pelo contador da empresa, sob trava, na mesma transação do INSERT
   const numero = await proximoNumeroOs(tx, empresaId);
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
      // O que a pessoa digitou vence; sem nada digitado, o padrão do tipo contado do dia agendado
      prazoExecucao: prazoAoCriar({ digitado: prazoDigitado, dataAgendada: prep.execucao.dataAgendada, diasDoTipo: parsed.data.usarPrazoPadrao === false ? null : prep.execucao.prazoExecucaoDias }),
      chamadoAbertoEm,
      observacoes: parsed.data.observacoes || null,
    },
   });
   // Chamado de cliente em contrato: fixa os limites do prazo de atendimento (comparecer e resolver)
   if (chamadoAbertoEm) await fixarLimitesDaOs(tx, criada.id);
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
