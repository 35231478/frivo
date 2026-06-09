import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mesclarQrConfig } from "@/lib/qr-config";
import { z } from "zod";

type Params = { params: Promise<{ token: string }> };

const chamadoSchema = z.object({
  tipo: z.enum(["CHAMADO", "ORCAMENTO"]).default("CHAMADO"),
  nome: z.string().min(2, "Informe seu nome"),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  telefone: z.string().max(20).optional().or(z.literal("")),
  descricao: z.string().min(5, "Descreva o problema (mín. 5 caracteres)"),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;

  const qrcode = await prisma.qrcode.findUnique({
    where: { tokenPublico: token },
    include: { equipamento: { select: { id: true, empresaId: true, unidadeId: true, unidade: { select: { clienteId: true } } } } },
  });
  if (!qrcode || !qrcode.equipamento) {
    return NextResponse.json({ erro: "QR Code inválido ou não vinculado a um equipamento." }, { status: 404 });
  }
  const equip = qrcode.equipamento;
  const empresaId = equip.empresaId;

  // Respeita as configurações de acesso público
  const cfg = mesclarQrConfig(
    (await prisma.configuracao.findUnique({ where: { empresaId }, select: { qrConfig: true } }))?.qrConfig,
  );
  if (!cfg.paginaPublicaAtiva) return NextResponse.json({ erro: "Página pública desativada." }, { status: 403 });

  const parsed = chamadoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Gating por tipo, conforme configurações
  if (d.tipo === "ORCAMENTO") {
    if (!cfg.botaoOrcamento || cfg.orcamentoSomenteLogado) {
      return NextResponse.json({ erro: "Solicitação de orçamento pública não está disponível." }, { status: 403 });
    }
  } else if (!cfg.botaoChamado || cfg.chamadoSomenteLogado) {
    return NextResponse.json({ erro: "Abertura de chamado pública não está disponível." }, { status: 403 });
  }

  const gestor =
    (await prisma.usuario.findFirst({ where: { empresaId, ativo: true, role: { in: ["ADMIN", "GERENTE"] } }, select: { id: true }, orderBy: { criadoEm: "asc" } })) ??
    (await prisma.usuario.findFirst({ where: { empresaId, ativo: true }, select: { id: true } }));
  if (!gestor) return NextResponse.json({ erro: "Empresa sem usuário responsável." }, { status: 400 });

  const ano = new Date().getFullYear();
  const totalOs = await prisma.ordemServico.count({ where: { empresaId } });
  const numero = `OS-${ano}-${String(totalOs + 1).padStart(4, "0")}`;
  const totalChamados = await prisma.ordemServico.count({ where: { empresaId, origem: "PORTAL_CLIENTE" } });
  const chamadoNumero = `CHM-${ano}-${String(totalChamados + 1).padStart(4, "0")}`;

  const contato = [`Solicitante: ${d.nome}`, d.email ? `E-mail: ${d.email}` : null, d.telefone ? `Telefone: ${d.telefone}` : null]
    .filter(Boolean)
    .join(" · ");
  const marcador = d.tipo === "ORCAMENTO" ? "[Orçamento via QR Code]" : "[Chamado via QR Code]";
  const descricao = `${d.tipo === "ORCAMENTO" ? "Solicitação de orçamento. " : ""}${d.descricao}\n\n${marcador} ${contato}`;

  const os = await prisma.ordemServico.create({
    data: {
      empresaId,
      numero,
      chamadoNumero,
      clienteId: equip.unidade!.clienteId,
      unidadeId: equip.unidadeId,
      equipamentoId: equip.id,
      criadoPorId: gestor.id,
      status: "AGUARDANDO_ATENDIMENTO",
      origem: "PORTAL_CLIENTE",
      prioridade: "NORMAL",
      descricao,
    },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: os.id, usuarioId: gestor.id, acao: d.tipo === "ORCAMENTO" ? "Orçamento solicitado via QR Code" : "Chamado aberto via QR Code", detalhes: `${chamadoNumero} — ${d.nome}` },
  });

  return NextResponse.json({ chamadoNumero }, { status: 201 });
}
