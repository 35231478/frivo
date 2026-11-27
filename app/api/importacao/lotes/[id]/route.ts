import { NextResponse } from "next/server";
import { previaDesfazer } from "@/lib/importacao/lotes";
import { exigirLotes } from "@/lib/importacao/lotes-rotas";

/** Prévia do "Desfazer lote": o que apaga, o que fica (com o motivo) e o que o lote só atualizou. Nada é gravado. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigirLotes();
  if (g.erro) return g.resposta;
  const p = await previaDesfazer((await params).id, g.ctx);
  if (!p) return NextResponse.json({ erro: "Importação não encontrada." }, { status: 404 });
  return NextResponse.json(p);
}
