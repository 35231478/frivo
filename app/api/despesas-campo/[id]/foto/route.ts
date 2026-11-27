import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { fotoDaDespesa, soEscritorio } from "@/lib/execucao/despesas";
import { respostaAnexo } from "@/lib/anexos-server";

type Params = { params: Promise<{ id: string }> };

/** A foto do cupom (escritório: qualquer despesa da empresa). */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const fora = soEscritorio(guard.session);
  if (fora) return fora;
  const { id } = await params;
  const foto = await fotoDaDespesa(guard.session.user.empresaId, id);
  if (!foto) return NextResponse.json({ erro: "Foto não encontrada." }, { status: 404 });
  return respostaAnexo({ nome: "cupom.jpg", conteudo: foto }, true);
}
