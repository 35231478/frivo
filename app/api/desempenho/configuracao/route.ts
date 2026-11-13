import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { ajustesSchema } from "@/lib/desempenho/regras";
import { configuracaoDoDesempenho, responder, salvarAjustes } from "@/lib/desempenho/servidor";

/** A configuração do Desempenho (abre o módulo na primeira vez). Exige "Desempenho › Gerenciar". */
export async function GET() {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  return responder(() => configuracaoDoDesempenho(guard.session.user.empresaId));
}

/** Ajustes gerais: prazo do retorno e tipos de OS que contam como corretiva. */
export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = ajustesSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  return responder(() => salvarAjustes(atorDa(guard.session), parsed.data));
}
