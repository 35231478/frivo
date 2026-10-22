import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const configuracaoSchema = z.object({
  clienteEmailObrigatorio: z.boolean().optional(),
  clienteWhatsappObrigatorio: z.boolean().optional(),
  clienteTelefoneObrigatorio: z.boolean().optional(),
  clienteCepObrigatorio: z.boolean().optional(),
  clienteRtObrigatorio: z.boolean().optional(),
  clienteArtObrigatorio: z.boolean().optional(),
  clienteExigirUnidade: z.boolean().optional(),
  clienteExigirDocumento: z.boolean().optional(),
  osExigirFoto: z.boolean().optional(),
  osExigirAssinatura: z.boolean().optional(),
  osPermitirSemContrato: z.boolean().optional(),
  osExigirQuestionario: z.boolean().optional(),
  osPermitirEdicaoConcluida: z.boolean().optional(),
  notifEmailAbrirOs: z.boolean().optional(),
  notifEmailConcluirOs: z.boolean().optional(),
  notifWhatsappAbrirOs: z.boolean().optional(),
  notifWhatsappConcluirOs: z.boolean().optional(),
  mostrarMapa: z.boolean().optional(),
  mostrarDistancia: z.boolean().optional(),
  mostrarTecnicoProximo: z.boolean().optional(),
  portalCorPrimaria: z.string().nullable().optional(),
  portalLogo: z.string().nullable().optional(),
  portalBoasVindas: z.string().nullable().optional(),
}).strict();

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;

  let config = await prisma.configuracao.findUnique({ where: { empresaId } });

  if (!config) {
    config = await prisma.configuracao.create({
      data: { empresaId },
    });
  }

  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  // Permissão, não role: quem tem "Configurações > Gerenciar" no perfil também pode (I5)
  if (!pode(session.user!.permissoes, "configuracoes", "gerenciar", session.user!.role)) {
    return NextResponse.json({ erro: "Sem permissão para alterar configurações." }, { status: 403 });
  }

  const empresaId = session.user!.empresaId;
  const body = await req.json();

  // Remove campos de controle antes de validar (id/empresaId não são editáveis aqui)
  const { id: _id, empresaId: _empresaId, ...entrada } = body;
  const parsed = configuracaoSchema.safeParse(entrada);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const dados = parsed.data;

  const config = await prisma.configuracao.upsert({
    where: { empresaId },
    create: { empresaId, ...dados },
    update: dados,
  });

  return NextResponse.json(config);
}
