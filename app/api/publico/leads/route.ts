import { NextResponse } from "next/server";
import { criarLeadDoSite } from "@/lib/leads/criar-lead-site";

/**
 * Endpoint público do lead vindo do site institucional (frivo.com.br — calculadora de BTU).
 * Protegido por API key (header X-Site-Token == SITE_API_TOKEN). NÃO exige login — `/api/publico/*`
 * já é liberado no middleware.
 *
 * O lead vira um CLIENTE com origem = SITE e um ORÇAMENTO "Lead do site — <nome>" (o que a tela
 * "Leads do site" lê). Toda a lógica fica em lib/leads/criar-lead-site (a calculadora first-party do
 * app usa a MESMA função, sem token). Nunca falha em silêncio: devolve erro claro.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const tokenEsperado = process.env.SITE_API_TOKEN;
  if (!tokenEsperado) {
    console.error("[publico/leads] SITE_API_TOKEN não configurado.");
    return NextResponse.json({ success: false, error: "Serviço indisponível." }, { status: 503 });
  }
  const tokenRecebido = req.headers.get("x-site-token");
  if (!tokenRecebido || tokenRecebido !== tokenEsperado) {
    return NextResponse.json({ success: false, error: "Não autorizado." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Requisição inválida." }, { status: 400 });
  }

  try {
    const r = await criarLeadDoSite(raw, "Calculadora de BTU do site");
    if (!r.ok) {
      // Validação / tenant: 400 com a mensagem clara (o campo ajuda a diagnosticar payload do site)
      console.error("[publico/leads] Lead recusado:", r.erro, r.campo ? `(campo: ${r.campo})` : "");
      const status = r.campo ? 400 : 500;
      return NextResponse.json({ success: false, error: r.erro, campo: r.campo }, { status });
    }
    return NextResponse.json({ success: true, orcamentoId: r.orcamentoId, codigo: r.codigo });
  } catch (e) {
    console.error("[publico/leads] Erro ao processar lead:", e);
    return NextResponse.json({ success: false, error: "Erro ao processar o lead." }, { status: 500 });
  }
}
