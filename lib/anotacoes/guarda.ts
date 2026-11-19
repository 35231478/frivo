import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { MSG_SO_O_DONO, ehDonoDoFrivo } from "@/lib/anotacoes/dono";
import type { Quem } from "@/lib/anotacoes/servidor";

/**
 * A guarda das rotas de anotação, num lugar só.
 *
 * A trava é de SERVIDOR, não cosmética: quem não é o dono leva 403 mesmo que descubra a URL. E o
 * `Quem` sai da SESSÃO (empresa + usuário), nunca do corpo do pedido — é isso que mantém o
 * isolamento multiempresa valendo igual para o SUPER_ADMIN, que é chave desta ferramenta e de
 * nada mais (lib/anotacoes/dono.ts).
 */
export async function guardaDoDono(): Promise<
  { erro: true; resposta: NextResponse } | { erro: false; quem: Quem }
> {
  const session = await auth();
  if (!session) return { erro: true, resposta: NextResponse.json({ erro: "Não autorizado" }, { status: 401 }) };
  if (!ehDonoDoFrivo(session.user)) {
    return { erro: true, resposta: NextResponse.json({ erro: MSG_SO_O_DONO }, { status: 403 }) };
  }
  return { erro: false, quem: { empresaId: session.user.empresaId, usuarioId: session.user.id } };
}
