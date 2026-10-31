import { NextResponse } from "next/server";
import { numeroFatura } from "@/lib/faturamento/fatura";
import { z } from "zod";
import type { ParcelamentoFaturar, ResultadoFaturar } from "@/lib/faturamento/faturar-server";

/** Corpo opcional do "Faturar": { parcelamento: { quantidade, primeiroVencimento } } (vazio = à vista) */
export async function lerParcelamento(req: Request): Promise<ParcelamentoFaturar | null> {
  const corpo = await req.json().catch(() => null);
  const r = z.object({
    parcelamento: z.object({ quantidade: z.number().int().min(1).max(48), primeiroVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable() }).nullable().optional(),
  }).safeParse(corpo ?? {});
  return r.success ? r.data.parcelamento ?? null : null;
}

/** Resposta HTTP do "Faturar" (orçamento e OS usam a mesma) */
export function respostaFaturar(r: ResultadoFaturar, rotuloOrigem: string) {
  if (r.tipo === "nao-encontrado") return NextResponse.json({ erro: `${rotuloOrigem} não encontrado(a).` }, { status: 404 });
  if (r.tipo === "bloqueado") return NextResponse.json({ erro: r.erro }, { status: 409 });
  if (r.tipo === "vazio") return NextResponse.json({ erro: r.erro }, { status: 400 });
  const corpo = {
    id: r.fatura.id, numero: r.fatura.numero, rotulo: `Fatura ${numeroFatura(r.fatura.numero)}`, jaExistia: r.tipo === "existente",
    ...(r.tipo === "criada" && r.parcelas ? { parcelas: r.parcelas } : {}),
    ...(r.tipo === "criada" && r.avisoParcelas ? { avisoParcelas: r.avisoParcelas } : {}),
  };
  return NextResponse.json(corpo, { status: r.tipo === "criada" ? 201 : 200 });
}
