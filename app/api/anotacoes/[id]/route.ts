import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardaDoDono } from "@/lib/anotacoes/guarda";
import { atualizarAnotacao, excluirAnotacao } from "@/lib/anotacoes/servidor";
import { STATUS_ANOTACAO, TEXTO_MAX } from "@/lib/anotacoes/regras";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(STATUS_ANOTACAO).optional(),
  texto: z.string().min(1).max(TEXTO_MAX).optional(),
}).refine((d) => d.status !== undefined || d.texto !== undefined, { message: "Nada para mudar." });

/** Muda o status (aberta / feita / descartada) ou o texto da anotação. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await guardaDoDono();
  if (g.erro) return g.resposta;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  const r = await atualizarAnotacao(g.quem, id, parsed.data);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.erro === "Anotação não encontrada." ? 404 : 400 });
  return NextResponse.json({ ok: true });
}

/**
 * Exclui de vez (o print vai com ela). "Descartada" é o caminho normal — ela só sai da lista pelo
 * filtro e o registro fica; este DELETE é para quando você quer o dado fora do banco.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const g = await guardaDoDono();
  if (g.erro) return g.resposta;
  const { id } = await params;
  const r = await excluirAnotacao(g.quem, id);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true });
}
