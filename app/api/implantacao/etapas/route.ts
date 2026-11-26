import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ehEtapaId } from "@/lib/implantacao/etapas";
import { marcarEtapa } from "@/lib/implantacao/servidor";

/**
 * Implantação: marca uma etapa como "Não se aplica / fazer depois" (conta como concluída para os 100%) ou a
 * reabre. Corpo: { etapa, dispensada: boolean }. Quem configura a empresa (Configurações › Gerenciar, a mesma
 * permissão do cartão). Empresa sempre da sessão. Só grava a marcação: nenhum cadastro é tocado.
 */
export async function PATCH(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const corpo = await req.json().catch(() => null);
  if (!corpo || !ehEtapaId(corpo.etapa) || typeof corpo.dispensada !== "boolean")
    return NextResponse.json({ erro: "Etapa inválida." }, { status: 400 });
  const dispensadas = await marcarEtapa(guard.session.user!.empresaId, corpo.etapa, corpo.dispensada);
  return NextResponse.json({ ok: true, dispensadas });
}
