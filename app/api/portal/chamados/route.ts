import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPortalSession } from "@/lib/auth-portal";
import { chamadoPortalSchema } from "@/lib/validations";

const MAP_URGENCIA: Record<string, "NORMAL" | "ALTA" | "CRITICO"> = {
  NORMAL: "NORMAL", URGENTE: "ALTA", CRITICO: "CRITICO",
};

export async function POST(req: NextRequest) {
  const sessao = await getPortalSession();
  if (!sessao?.user) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!sessao.user.permissoes?.abrirChamados) {
    return NextResponse.json({ erro: "Sem permissão para abrir chamados" }, { status: 403 });
  }
  const { clienteId, empresaId } = sessao.user;
  const contatoId = sessao.user.id;

  const parsed = chamadoPortalSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Validações de tenant: unidade/equipamento precisam ser do próprio cliente
  if (d.unidadeId) {
    const u = await prisma.unidade.findFirst({ where: { id: d.unidadeId, clienteId, empresaId }, select: { id: true } });
    if (!u) return NextResponse.json({ erro: "Unidade inválida" }, { status: 400 });
  }
  if (d.equipamentoId) {
    const e = await prisma.equipamento.findFirst({ where: { id: d.equipamentoId, empresaId, unidade: { clienteId } }, select: { id: true, unidadeId: true } });
    if (!e) return NextResponse.json({ erro: "Equipamento inválido" }, { status: 400 });
  }

  // Responsável interno pela criação (gestor/admin da empresa)
  const gestor = await prisma.usuario.findFirst({
    where: { empresaId, ativo: true, role: { in: ["ADMIN", "GERENTE"] } },
    select: { id: true },
    orderBy: { criadoEm: "asc" },
  }) ?? await prisma.usuario.findFirst({ where: { empresaId, ativo: true }, select: { id: true } });
  if (!gestor) return NextResponse.json({ erro: "Empresa sem usuário responsável" }, { status: 400 });

  const ano = new Date().getFullYear();
  const totalOs = await prisma.ordemServico.count({ where: { empresaId } });
  const numero = `OS-${ano}-${String(totalOs + 1).padStart(4, "0")}`;
  const totalChamados = await prisma.ordemServico.count({ where: { empresaId, origem: "PORTAL_CLIENTE" } });
  const chamadoNumero = `CHM-${ano}-${String(totalChamados + 1).padStart(4, "0")}`;

  const descricao = (d.tipoProblema ? `[${d.tipoProblema}] ` : "") + d.descricao;

  const os = await prisma.ordemServico.create({
    data: {
      empresaId,
      numero,
      chamadoNumero,
      clienteId,
      unidadeId: d.unidadeId || null,
      equipamentoId: d.equipamentoId || null,
      contatoOrigemId: contatoId,
      criadoPorId: gestor.id,
      status: "AGUARDANDO_ATENDIMENTO",
      origem: "PORTAL_CLIENTE",
      prioridade: MAP_URGENCIA[d.urgencia] ?? "NORMAL",
      descricao,
      anexos: d.fotos.length > 0 ? { create: d.fotos.map((f) => ({ nome: f.nome, tipo: f.tipo, tamanho: f.tamanho, conteudo: f.conteudo })) } : undefined,
    },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: os.id, usuarioId: gestor.id, acao: "Chamado aberto pelo portal", detalhes: `${chamadoNumero} — ${sessao.user.name ?? "cliente"}` },
  });

  return NextResponse.json({ id: os.id, chamadoNumero }, { status: 201 });
}
