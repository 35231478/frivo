import { NextRequest, after } from "next/server";
import { admissaoPorToken, assinar, avisarRh } from "@/lib/admissao/admissao-server";
import { corpo, ipDaRequisicao, responderPublico } from "@/lib/admissao/admissao-rotas";

/**
 * Assina o contrato: nome digitado + IP + navegador + data/hora + selfie, com o texto do contrato
 * CONGELADO como prova. A troca de situação é atômica (dois cliques não assinam duas vezes).
 * Quem gerou o convite é avisado DEPOIS da resposta — falha de e-mail não derruba a assinatura.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await corpo(req);
  const origem = new URL(req.url).origin;
  const resposta = await responderPublico(req, () => assinar(token, {
    nome: typeof b.nome === "string" ? b.nome : "",
    selfie: typeof b.selfie === "string" ? b.selfie : "",
  }, { ip: ipDaRequisicao(req.headers), userAgent: req.headers.get("user-agent") }));
  if (resposta.status === 200) {
    after(async () => {
      const a = await admissaoPorToken(token);
      if (a) await avisarRh(a.id, origem).catch((e) => console.error("[admissão] aviso ao RH", e));
    });
  }
  return resposta;
}
