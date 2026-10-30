import { NextResponse } from "next/server";
import { numeroFatura } from "@/lib/faturamento/fatura";
import type { ResultadoFaturar } from "@/lib/faturamento/faturar-server";

/** Resposta HTTP do "Faturar" (orçamento e OS usam a mesma) */
export function respostaFaturar(r: ResultadoFaturar, rotuloOrigem: string) {
  if (r.tipo === "nao-encontrado") return NextResponse.json({ erro: `${rotuloOrigem} não encontrado(a).` }, { status: 404 });
  if (r.tipo === "bloqueado") return NextResponse.json({ erro: r.erro }, { status: 409 });
  if (r.tipo === "vazio") return NextResponse.json({ erro: r.erro }, { status: 400 });
  const corpo = { id: r.fatura.id, numero: r.fatura.numero, rotulo: `Fatura ${numeroFatura(r.fatura.numero)}`, jaExistia: r.tipo === "existente" };
  return NextResponse.json(corpo, { status: r.tipo === "criada" ? 201 : 200 });
}
