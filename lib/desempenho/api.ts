/** DESEMPENHO — o que as rotas de API têm em comum (mês pedido, corpo, erro de validação, quem age). */
import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { ZodError } from "zod";
import { pode, type Permissoes } from "@/lib/permissoes";
import { competenciaAtual, ehCompetencia } from "./regras";
import type { Ator } from "./servidor";

/** O mês pedido em `?mes=AAAA-MM`; fora do formato (ou ausente) = o mês corrente. */
export function mesPedido(req: NextRequest, agora: Date = new Date()): string {
  const mes = req.nextUrl.searchParams.get("mes");
  return ehCompetencia(mes) ? mes : competenciaAtual(agora);
}

export const corpo = (req: NextRequest) => req.json().catch(() => ({}));

export const invalido = (erro: ZodError) => NextResponse.json({ erro: erro.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

export const atorDa = (session: Session): Ator => ({ empresaId: session.user.empresaId, usuarioId: session.user.id });

/** Valores em reais (bônus, valor das faixas): só para quem configura o Desempenho. */
export const veValores = (session: Session) => pode(session.user.permissoes as Permissoes, "desempenho", "gerenciar", session.user.role);
