import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdminExportacao } from "@/lib/exportacao/acesso";

export const dynamic = "force-dynamic";

/** As últimas exportações da empresa (quem, quando, parte, situação) — a trilha que a tela mostra. */
export async function GET() {
  const g = await exigirAdminExportacao();
  if (!g.ok) return g.resposta;
  const exportacoes = await prisma.exportacaoDados.findMany({
    where: { empresaId: g.empresaId }, orderBy: { criadoEm: "desc" }, take: 20,
    select: { id: true, usuarioNome: true, parte: true, criadoEm: true, concluidaEm: true, arquivos: true, linhas: true, erro: true },
  });
  return NextResponse.json({ exportacoes });
}
