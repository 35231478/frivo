import { NextResponse } from "next/server";
import { desfazerLote } from "@/lib/importacao/lotes";
import { exigirLotes } from "@/lib/importacao/lotes-rotas";

/**
 * Desfaz o lote: apaga SÓ o que ele criou e ainda não foi usado (conferido de novo na hora); o que ele só atualizou
 * nunca é desfeito. Tudo ou nada (uma transação). Pode ser repetido: o que ficou por estar em uso sai depois, quando o uso sumir.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigirLotes();
  if (g.erro) return g.resposta;
  let r: Awaited<ReturnType<typeof desfazerLote>>;
  try {
    r = await desfazerLote((await params).id, g.ctx);
  } catch (e) {
    // tudo ou nada: se algo mudou no meio (ou a transação não fechou), nada foi apagado
    console.error("[importacao/lotes] desfazer", e);
    const msg = e instanceof Error && /mudou durante o desfazer/.test(e.message) ? e.message : "Não foi possível desfazer agora. Nada foi apagado; tente de novo.";
    return NextResponse.json({ erro: msg }, { status: 409 });
  }
  if (!r) return NextResponse.json({ erro: "Importação não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}
