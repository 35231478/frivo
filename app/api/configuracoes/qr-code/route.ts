import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { mesclarQrConfig } from "@/lib/qr-config";
import { z } from "zod";

const qrConfigSchema = z.object({
  paginaPublicaAtiva: z.boolean(),
  mostrarHistorico: z.boolean(),
  mostrarProximaManutencao: z.boolean(),
  mostrarDadosEquipamento: z.boolean(),
  mostrarLocalizacao: z.boolean(),
  botaoWhatsapp: z.boolean(),
  botaoOrcamento: z.boolean(),
  botaoChamado: z.boolean(),
  whatsappNumero: z.string().max(20),
  linkSite: z.string().max(300),
  mensagemBoasVindas: z.string().max(500),
  chamadoSomenteLogado: z.boolean(),
  historicoSomenteLogado: z.boolean(),
  orcamentoSomenteLogado: z.boolean(),
}).strict();

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const config = await prisma.configuracao.findUnique({ where: { empresaId }, select: { qrConfig: true } });
  return NextResponse.json(mesclarQrConfig(config?.qrConfig));
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  // Permissão, não role: quem tem "Configurações > Gerenciar" no perfil também pode (I5)
  if (!pode(session.user!.permissoes, "configuracoes", "gerenciar", session.user!.role)) {
    return NextResponse.json({ erro: "Sem permissão para alterar configurações." }, { status: 403 });
  }

  const empresaId = session.user!.empresaId;
  const parsed = qrConfigSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.configuracao.upsert({
    where: { empresaId },
    create: { empresaId, qrConfig: parsed.data },
    update: { qrConfig: parsed.data },
  });

  return NextResponse.json(parsed.data);
}
