import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { DESCRICAO_PADRAO_PMOC } from "@/lib/pmoc";
import { configPmocSchema } from "@/lib/pmoc-avisos";
import { configPmoc } from "@/lib/pmoc-documento-server";

/** O padrão do PMOC desta empresa: antecedência do aviso de vencimento e texto técnico dos planos novos. */
export async function GET() {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json({ ...(await configPmoc(guard.session.user!.empresaId)), textoDoSistema: DESCRICAO_PADRAO_PMOC });
}

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const parsed = configPmocSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  // Igual ao texto do sistema não precisa ser gravado: vazio já significa "o padrão do sistema"
  const textoPadrao = parsed.data.textoPadrao === DESCRICAO_PADRAO_PMOC.trim() ? null : parsed.data.textoPadrao;
  const dados = { diasAviso: parsed.data.diasAviso, textoPadrao };
  await prisma.pmocConfiguracao.upsert({ where: { empresaId }, create: { empresaId, ...dados }, update: dados });
  return NextResponse.json({ ...dados, textoDoSistema: DESCRICAO_PADRAO_PMOC });
}
