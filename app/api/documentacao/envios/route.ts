import { type NextRequest } from "next/server";
import { criarEnvio, lerSelecao, listarEnvios } from "@/lib/documentacao/pacote-server";
import { corpo, guardaDeEnvio, origemDa, responderEnvio } from "@/lib/documentacao/pacote-rotas";

/** O histórico: o que foi enviado, para qual cliente, por quem e quando (filtra por cliente). */
export async function GET(req: NextRequest) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const q = req.nextUrl.searchParams;
  return responderEnvio(() => listarEnvios(ator.empresaId, {
    clienteId: q.get("clienteId"),
    busca: q.get("q"),
    situacao: q.get("situacao"),
    pagina: Number(q.get("pagina") ?? 1) || 1,
    porPagina: Number(q.get("porPagina") ?? 50) || 50,
  }));
}

/**
 * Monta o pacote de UM cliente e entrega pela via escolhida: LINK (nasce o link com prazo), EMAIL
 * (o link vai no corpo, nunca anexo) ou ZIP (grava; o arquivo é baixado em …/[id]/zip).
 * Documento vencido segura o pacote (409, com a lista); documento faltando pede confirmação.
 */
export async function POST(req: NextRequest) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const b = await corpo(req);
  const email = b.email && typeof b.email === "object" ? (b.email as Record<string, unknown>) : {};
  return responderEnvio(() => criarEnvio({
    ...lerSelecao(b),
    via: String(b.via ?? ""),
    validadeDias: b.validadeDias,
    cienteDasFaltas: b.cienteDasFaltas === true,
    email: { para: email.para, cc: email.cc, copiaParaMim: email.copiaParaMim === true },
  }, ator, origemDa(req), new Date(), new URL(req.url).origin), 201);
}
