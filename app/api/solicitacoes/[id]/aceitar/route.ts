import { NextRequest, NextResponse } from "next/server";
import { erroDeValidacao, erroNoCampo } from "@/lib/forms/erros-server";
import { fixarLimitesDaOs } from "@/lib/atendimento/prazo-server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { SOLICITACAO_PENDENTE } from "@/lib/solicitacoes";
import { ErroTecnicos, MSG_SEM_EXECUTOR, gravarTecnicos, lerDefinicao, lerVeiculo, resolverTecnicos, resolverVeiculo } from "@/lib/atividade-tecnicos";
import { instanteBR } from "@/lib/fuso";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  dataHora: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Informe a data e a hora do atendimento."),
  descricao: z.string().trim().min(5, "Descrição muito curta."),
  prioridade: z.enum(["BAIXA", "NORMAL", "ALTA", "URGENTE", "CRITICO"]).default("NORMAL"),
  unidadeId: z.string().optional().nullable(),
  contratoId: z.string().optional().nullable(),
  equipamentoId: z.string().optional().nullable(),
  tecnicoId: z.string().optional().nullable(),
  tecnicoIds: z.array(z.string()).optional(),
  responsavelId: z.string().optional().nullable(),
  equipeId: z.string().optional().nullable(),
  veiculoId: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

/**
 * Aceita a solicitação do cliente: a MESMA OS (mantém nº e chamado) passa para
 * AGENDADA na data/hora escolhida, com uma atividade agendada — só a partir daí
 * ela aparece no calendário.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    select: { id: true, status: true, origem: true, clienteId: true, equipamentoId: true, chamadoNumero: true, numero: true },
  });
  if (!os || os.origem !== "PORTAL_CLIENTE") return NextResponse.json({ erro: "Solicitação não encontrada" }, { status: 404 });
  if (os.status !== SOLICITACAO_PENDENTE.status)
    return NextResponse.json({ erro: "Esta solicitação já foi tratada (aceita ou recusada) por outra pessoa." }, { status: 409 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const msg = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return erroDeValidacao(parsed.error, msg ?? "Dados inválidos");
  }
  const d = parsed.data;
  const [y, mo, di, h, mi] = d.dataHora.split(/[-T:]/).map(Number);
  // A data/hora escolhida é de Brasília (o servidor roda em UTC: antes gravava 3 h antes)
  const quando = instanteBR(y, mo - 1, di, h, mi);
  if (Number.isNaN(quando.getTime())) return erroNoCampo("dataHora", "Data inválida.");

  // Tudo precisa ser do mesmo cliente/empresa
  const unidadeId = d.unidadeId || null;
  if (unidadeId && !(await prisma.unidade.findFirst({ where: { id: unidadeId, clienteId: os.clienteId, empresaId }, select: { id: true } })))
    return erroNoCampo("unidadeId", "Endereço inválido para este cliente.");
  const equipamentoId = d.equipamentoId || null;
  if (equipamentoId && !(await prisma.equipamento.findFirst({ where: { id: equipamentoId, empresaId, unidade: { clienteId: os.clienteId } }, select: { id: true } })))
    return erroNoCampo("equipamentoId", "Equipamento inválido para este cliente.");
  const contratoId = d.contratoId || null;
  if (contratoId && !(await prisma.contrato.findFirst({ where: { id: contratoId, empresaId, clienteId: os.clienteId }, select: { id: true } })))
    return erroNoCampo("contratoId", "Contrato inválido para este cliente.");
  // Quem executa é obrigatório (equipe OU colaboradores); veículo puxado da equipe/colaborador ou escolhido
  const corpo = parsed.data as any;
  const def = lerDefinicao(corpo);
  if (!def) return erroNoCampo("execucao", MSG_SEM_EXECUTOR);
  let tecnicos: Awaited<ReturnType<typeof resolverTecnicos>>;
  let veiculoId: string | null;
  try {
    tecnicos = await resolverTecnicos(empresaId, def, null, { exigir: true });
    veiculoId = await resolverVeiculo(empresaId, lerVeiculo(corpo), tecnicos);
  } catch (e) { if (e instanceof ErroTecnicos) return erroNoCampo("execucao", e.message); throw e; }

  // Troca de status condicional: se outra pessoa tratou no meio do caminho, não sobrescreve
  const atualizado = await prisma.$transaction(async (tx) => {
    const r = await tx.ordemServico.updateMany({
      where: { id, empresaId, ...SOLICITACAO_PENDENTE },
      data: {
        status: "AGENDADA",
        descricao: d.descricao,
        prioridade: d.prioridade as any,
        unidadeId,
        contratoId,
        equipamentoId: equipamentoId ?? os.equipamentoId,
        observacoes: d.observacoes || null,
        previsaoConclusao: quando,
        responsavelId: session.user!.id,
      },
    });
    if (r.count === 0) return false;
    const atividade = await tx.atividadeOs.create({
      data: {
        empresaId, ordemServicoId: id, tecnicoId: tecnicos.responsavel, veiculoId, dataAgendada: quando, status: "AGENDADA",
        titulo: `Atendimento do chamado ${os.chamadoNumero ?? os.numero}`,
      },
    });
    await gravarTecnicos(tx, atividade.id, tecnicos);
    // Contrato e prioridade ficaram definidos: fixa os limites do prazo de atendimento, contados
    // desde a hora em que o cliente abriu o chamado
    await fixarLimitesDaOs(tx, id);
    const equip = equipamentoId ?? os.equipamentoId;
    if (equip) await tx.atividadeEquipamento.create({ data: { atividadeId: atividade.id, equipamentoId: equip } });
    await tx.osHistorico.create({
      data: {
        ordemServicoId: id, usuarioId: session.user!.id, acao: "Solicitação aceita",
        detalhes: `AGUARDANDO_ATENDIMENTO → AGENDADA — atendimento em ${String(di).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y} às ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`,
      },
    });
    return true;
  });
  if (!atualizado) return NextResponse.json({ erro: "Esta solicitação já foi tratada (aceita ou recusada) por outra pessoa." }, { status: 409 });

  return NextResponse.json({ ok: true, id, numero: os.chamadoNumero ?? os.numero, data: `${y}-${String(mo).padStart(2, "0")}-${String(di).padStart(2, "0")}` });
}
