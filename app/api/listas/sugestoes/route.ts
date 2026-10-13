import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode, type Permissoes } from "@/lib/permissoes";
import { ehListaSugestao, sugerir, SUGESTOES } from "@/lib/listas/sugestoes";

/**
 * GET /api/listas/sugestoes?lista=clientes&q=sant → { sugestoes: [{ id, rotulo, detalhe, href }] }
 * As ~5 que mais combinam (typeahead das listas). Empresa da sessão; precisa ver o módulo da lista.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const u = session?.user;
  if (!u) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const lista = req.nextUrl.searchParams.get("lista") ?? "";
  if (!ehListaSugestao(lista)) return NextResponse.json({ erro: "Lista inexistente" }, { status: 404 });
  if (!pode(u.permissoes as Permissoes, SUGESTOES[lista].modulo, "visualizar", u.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  return NextResponse.json({ sugestoes: await sugerir(lista, u.empresaId, req.nextUrl.searchParams.get("q") ?? "") });
}
