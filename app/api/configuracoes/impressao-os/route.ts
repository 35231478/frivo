import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { configRelatorioSchema } from "@/lib/relatorio-os/config";
import { getConfigRelatorio } from "@/lib/relatorio-os/config-server";

/**
 * Configuração de impressão do relatório da OS — da empresa da sessão.
 * GET: Configurações › visualizar. PUT: Configurações › gerenciar (todas as seções, { ativo, cliente }, e, opcional,
 * `mostrarEspecialidadesTecnico` — Leva J).
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
  const corpo = await req.json().catch(() => null);
  // Leva J: "Mostrar especialidades do técnico" vai junto das seções (opcional; sem ele, fica como está)
  const { mostrarEspecialidadesTecnico: esp, ...secoes } = corpo && typeof corpo === "object" ? corpo as Record<string, unknown> : {} as Record<string, unknown>;
  if (esp !== undefined && typeof esp !== "boolean") return NextResponse.json({ erro: "Configuração inválida." }, { status: 400 });
  const parsed = configRelatorioSchema.safeParse(secoes);
  if (!parsed.success) return NextResponse.json({ erro: "Configuração inválida." }, { status: 400 });
  const extra = esp === undefined ? {} : { mostrarEspecialidadesTecnico: esp };
  await prisma.configuracao.upsert({
    where: { empresaId },
    create: { empresaId, relatorioOsConfig: parsed.data, ...extra },
    update: { relatorioOsConfig: parsed.data, ...extra },
  });
  return NextResponse.json({ ...parsed.data, ...extra });
}
