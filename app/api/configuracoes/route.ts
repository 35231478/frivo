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
  // ISS (%) sobre serviços nos orçamentos — 0 a 100, em centésimos
  issAliquota: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(String(v).replace(",", "."))),
    z.number({ invalid_type_error: "Alíquota de ISS inválida" }).min(0, "A alíquota de ISS vai de 0 a 100%").max(100, "A alíquota de ISS vai de 0 a 100%")
      .transform((v) => Math.round(v * 100) / 100).optional()
  ),
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

  // Remove campos de controle antes de validar (id/empresaId não são editáveis aqui) e os que têm
  // tela/rota própria (QR Code e impressão da OS) — a tela manda a configuração inteira de volta
  const { id: _id, empresaId: _empresaId, qrConfig: _qr, relatorioOsConfig: _rel, ...entrada } = body;
  const parsed = configuracaoSchema.safeParse(entrada);
  if (!parsed.success) {
    const iss = parsed.error.flatten().fieldErrors.issAliquota?.[0];
    return NextResponse.json({ erro: iss ?? "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const dados = parsed.data;

  const config = await prisma.configuracao.upsert({
    where: { empresaId },
    create: { empresaId, ...dados },
    update: dados,
  });

  return NextResponse.json(config);
}
