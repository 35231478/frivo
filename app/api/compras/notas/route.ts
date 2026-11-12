import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { lerPaginacao, paramsDe } from "@/lib/listagem";
import { ErroNota, importarNota, listarNotas } from "@/lib/compras/notas";
import { TAMANHO_MAX_XML } from "@/lib/compras/nfe";

/** GET /api/compras/notas — notas de compra da empresa (Estoque › visualizar) */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const { pagina, porPagina } = lerPaginacao(paramsDe(req.nextUrl.searchParams));
  return NextResponse.json(await listarNotas(guard.session.user!.empresaId, { pagina, porPagina }));
}

/**
 * POST /api/compras/notas — importa o XML da NF-e (multipart: campo "xml"; ou JSON { xml }).
 * Estoque › gerenciar. 201 = importada (itens já conhecidos vêm vinculados); 409 = nota repetida.
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  let xml = "";
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const arq = (await req.formData()).get("xml");
      if (!arq || typeof arq === "string") return NextResponse.json({ erro: "Envie o arquivo XML da nota." }, { status: 400 });
      if (arq.size > TAMANHO_MAX_XML) return NextResponse.json({ erro: "Arquivo grande demais para uma NF-e (máx. 2 MB)." }, { status: 400 });
      xml = await arq.text();
    } else {
      const corpo = await req.json().catch(() => null);
      xml = typeof corpo?.xml === "string" ? corpo.xml : "";
    }
  } catch {
    return NextResponse.json({ erro: "Não foi possível ler o arquivo." }, { status: 400 });
  }
  try {
    const r = await importarNota({ empresaId: user.empresaId, usuarioId: user.id, xml });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof ErroNota) return NextResponse.json({ erro: e.message, ...e.extra }, { status: e.status });
    throw e;
  }
}
