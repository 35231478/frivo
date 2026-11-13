/** DESEMPENHO — o erro de regra das rotas e quem está agindo (separado para os módulos de servidor se importarem sem ciclo). */
import { NextResponse } from "next/server";

/** Erro de regra: vira a resposta da rota com este status */
export class ErroDesempenho extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface Ator { empresaId: string; usuarioId: string }

export async function responder<T>(fazer: () => Promise<T>, status = 200): Promise<NextResponse> {
  try { return NextResponse.json(await fazer(), { status, headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) {
    if (e instanceof ErroDesempenho) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
