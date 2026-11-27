import { NextResponse } from "next/server";
import { listarLotes } from "@/lib/importacao/lotes";
import { exigirLotes } from "@/lib/importacao/lotes-rotas";

/** As importações por planilha da empresa (Implantação › Importações), da mais nova para a mais antiga. */
export async function GET() {
  const g = await exigirLotes();
  if (g.erro) return g.resposta;
  return NextResponse.json({ lotes: await listarLotes(g.ctx.empresaId) });
}
