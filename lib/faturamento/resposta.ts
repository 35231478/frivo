import { NextResponse } from "next/server";
import { numeroFatura, rotuloParcial, type PedidoParcial } from "@/lib/faturamento/fatura";
import { z } from "zod";
import type { ParcelamentoFaturar, ResultadoFaturar } from "@/lib/faturamento/faturar-server";

const esquema = z.object({
  parcelamento: z.object({ quantidade: z.number().int().min(1).max(48), primeiroVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable() }).nullable().optional(),
  // P5: "Faturar parcial" — por valor OU por percentual do total da origem
  parcial: z.object({ valor: z.number().positive().optional().nullable(), percentual: z.number().positive().max(100).optional().nullable() }).nullable().optional(),
});

export type CorpoFaturar = { ok: true; parcelamento: ParcelamentoFaturar | null; parcial: PedidoParcial | null } | { ok: false; resposta: NextResponse };

/**
 * Corpo opcional do "Faturar": { parcelamento?, parcial? } (vazio = fatura o saldo, à vista). Corpo inválido
 * (percentual acima de 100, valor negativo…) é recusado com 400 — nunca vira um "Faturar" cheio por engano.
 */
export async function lerCorpoFaturar(req: Request): Promise<CorpoFaturar> {
  const corpo = await req.json().catch(() => null);
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) return { ok: false, resposta: NextResponse.json({ erro: "Pedido inválido: confira o valor ou o percentual da parte e as parcelas." }, { status: 400 }) };
  const parcial = r.data.parcial && (r.data.parcial.valor != null || r.data.parcial.percentual != null) ? r.data.parcial : null;
  return { ok: true, parcelamento: r.data.parcelamento ?? null, parcial };
}

/** Só o parcelamento (compatibilidade): corpo inválido conta como "à vista" */
export async function lerParcelamento(req: Request): Promise<ParcelamentoFaturar | null> {
  const c = await lerCorpoFaturar(req);
  return c.ok ? c.parcelamento : null;
}

/** Resposta HTTP do "Faturar" (orçamento e OS usam a mesma) */
export function respostaFaturar(r: ResultadoFaturar, rotuloOrigem: string) {
  if (r.tipo === "nao-encontrado") return NextResponse.json({ erro: `${rotuloOrigem} não encontrado(a).` }, { status: 404 });
  if (r.tipo === "bloqueado") return NextResponse.json({ erro: r.erro }, { status: 409 });
  if (r.tipo === "vazio") return NextResponse.json({ erro: r.erro }, { status: 400 });
  const parcial = r.tipo === "criada" ? r.parcial : undefined;
  const corpo = {
    id: r.fatura.id, numero: r.fatura.numero, jaExistia: r.tipo === "existente",
    rotulo: `Fatura ${numeroFatura(r.fatura.numero)}${parcial ? ` (${rotuloParcial(parcial.percentual)})` : ""}`,
    ...(r.tipo === "criada" && r.parcelas ? { parcelas: r.parcelas } : {}),
    ...(r.tipo === "criada" && r.avisoParcelas ? { avisoParcelas: r.avisoParcelas } : {}),
    ...(parcial ? { parcial } : {}),
  };
  return NextResponse.json(corpo, { status: r.tipo === "criada" ? 201 : 200 });
}
