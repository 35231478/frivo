import { NextRequest, NextResponse } from "next/server";
import { receberAviso } from "@/lib/nfse/webhook-server";
import { segredoDaChamada } from "@/lib/nfse/webhook";

/**
 * Aviso automático (webhook) de NFS-e do PlugNotas. A URL cadastrada lá leva ?token=<segredo da
 * empresa> (gerado em Dados fiscais; aceito também no Authorization: Bearer). O segredo identifica
 * a empresa e autentica o aviso.
 *
 * O corpo é só um AVISO: nunca muda a nota. As notas apontadas (só da empresa do segredo) são
 * consultadas no PlugNotas e vale a situação que ele devolve (lib/nfse/webhook-server.ts).
 * Respostas: 401 segredo ausente/desconhecido · 413 corpo grande demais · 503 o PlugNotas não
 * respondeu à consulta (ele manda o aviso de novo) · 200 o resto (nota desconhecida inclusive).
 *
 * Liberado no middleware (/api/webhooks).
 */
const MAX_CORPO = 256 * 1024;

export async function POST(req: NextRequest) {
  const segredo = segredoDaChamada(req.nextUrl.searchParams.get("token"), req.headers);
  if (!segredo) return NextResponse.json({ erro: "token ausente" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_CORPO) return NextResponse.json({ erro: "corpo grande demais" }, { status: 413 });
  const bruto = await req.text().catch(() => "");
  if (bruto.length > MAX_CORPO) return NextResponse.json({ erro: "corpo grande demais" }, { status: 413 });
  let corpo: unknown = null;
  try { corpo = bruto ? JSON.parse(bruto) : null; } catch { corpo = null; }

  const r = await receberAviso(segredo, corpo);
  if (!r) return NextResponse.json({ erro: "token inválido" }, { status: 401 });
  if (r.falhas > 0) return NextResponse.json({ ok: false, consultadas: r.consultadas }, { status: 503 });
  return NextResponse.json({ ok: true, consultadas: r.consultadas });
}

// O PlugNotas pode validar a URL com um GET — respondemos 200 (sem tocar em nada).
export async function GET() {
  return NextResponse.json({ ok: true });
}
