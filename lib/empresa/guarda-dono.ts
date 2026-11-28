import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { ehDonoDoFrivo, MSG_SO_O_DONO_EMPRESAS } from "@/lib/anotacoes/dono";

/**
 * A porta das rotas da área de Empresas (/api/admin/empresas/**), num lugar só: sem sessão 401; qualquer papel que
 * não seja o dono do Frivo (SUPER_ADMIN — inclusive o ADMIN de uma empresa-cliente) recebe 403.
 */
export async function exigirDonoDoFrivo(): Promise<{ erro: NextResponse; session?: undefined } | { erro?: undefined; session: Session }> {
  const session = await auth();
  if (!session?.user) return { erro: NextResponse.json({ erro: "Não autenticado" }, { status: 401 }) };
  if (!ehDonoDoFrivo(session.user)) return { erro: NextResponse.json({ erro: MSG_SO_O_DONO_EMPRESAS }, { status: 403 }) };
  return { session };
}
