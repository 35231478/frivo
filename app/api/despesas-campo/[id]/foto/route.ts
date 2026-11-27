import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { respostaAnexo } from "@/lib/anexos-server";
import { fotoDaDespesa } from "@/lib/execucao/despesas";

type Params = { params: Promise<{ id: string }> };

/** A foto do cupom (escritório: qualquer despesa da empresa). */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const foto = await fotoDaDespesa(guard.session.user.empresaId, id);
  if (!foto) return NextResponse.json({ erro: "Foto não encontrada." }, { status: 404 });
  return respostaAnexo({ nome: "cupom.jpg", conteudo: foto }, true);
}
