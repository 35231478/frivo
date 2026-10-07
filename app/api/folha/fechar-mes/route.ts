import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { competenciaDe, competenciaValida } from "@/lib/folha/calculo";
import { fecharMes } from "@/lib/folha/server";
import { partesBR } from "@/lib/fuso";

/**
 * Grava a foto do custo de pessoal de um mês (competência "AAAA-MM"), com os dados atuais.
 * Refazer substitui a foto daquela competência. Não aceita mês futuro.
 */
const schema = z.object({ competencia: z.string().refine(competenciaValida, "Competência inválida (AAAA-MM)") }).strict();

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { ano, mes } = partesBR();
  if (parsed.data.competencia > competenciaDe(ano, mes)) return NextResponse.json({ erro: "Não dá para fechar um mês futuro" }, { status: 400 });

  const r = await fecharMes(session.user!.empresaId, parsed.data.competencia, session.user!.name ?? session.user!.email ?? "usuário");
  return NextResponse.json({ ok: true, ...r });
}
