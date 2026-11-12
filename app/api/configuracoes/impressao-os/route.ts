import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { configRelatorioSchema } from "@/lib/relatorio-os/config";
import { getConfigRelatorio } from "@/lib/relatorio-os/config-server";

/**
 * Configuração de impressão do relatório da OS — da empresa da sessão.
 * GET: Configurações › visualizar. PUT: Configurações › gerenciar (todas as seções, { ativo, cliente }).
 */
export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await getConfigRelatorio(guard.session.user!.empresaId));
}

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const parsed = configRelatorioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Configuração inválida." }, { status: 400 });
  await prisma.configuracao.upsert({
    where: { empresaId },
    create: { empresaId, relatorioOsConfig: parsed.data },
    update: { relatorioOsConfig: parsed.data },
  });
  return NextResponse.json(parsed.data);
}
