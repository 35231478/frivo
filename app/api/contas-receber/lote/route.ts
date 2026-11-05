import type { NextRequest } from "next/server";
import { rotaLote } from "@/lib/financeiro/lote-rota";

export const maxDuration = 60;

/** Ações em lote em Contas a Receber: dar como recebido, alterar vencimento, cancelar (lib/financeiro/lote-rota). */
export const POST = (req: NextRequest) => rotaLote(req, "receber");
