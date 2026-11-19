import { NextRequest, NextResponse } from "next/server";
import { guardaDoDono } from "@/lib/anotacoes/guarda";
import { printDaAnotacao } from "@/lib/anotacoes/servidor";
import { respostaFoto } from "@/lib/anexos-server";

type Params = { params: Promise<{ id: string }> };

/**
 * A imagem do print, servida por rota própria — é por isso que ela mora em tabela separada: a
 * listagem lê só a anotação e nunca arrasta base64. Mesmo padrão dos anexos do sistema.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const g = await guardaDoDono();
  if (g.erro) return g.resposta;
  const { id } = await params;
  const conteudo = await printDaAnotacao(g.quem, id);
  if (!conteudo) return NextResponse.json({ erro: "Print não encontrado" }, { status: 404 });
  // O tipo sai dos BYTES e só imagem é servida (nosniff): o mesmo helper das fotos do sistema
  return respostaFoto(conteudo);
}
