import { type NextRequest } from "next/server";
import { criarLote } from "@/lib/documentacao/pacote-server";
import { corpo, guardaDeEnvio, origemDa, responderEnvio } from "@/lib/documentacao/pacote-rotas";

/**
 * Vários clientes de uma vez (a renovação anual). Por dentro é um envio por cliente: cada um com o
 * seu link, os seus documentos e os seus destinatários — nunca um link dividido, nunca um cliente
 * em cópia de outro. A resposta diz, cliente a cliente, o que saiu e o que ficou (e por quê).
 */
export async function POST(req: NextRequest) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const b = await corpo(req);
  return responderEnvio(() => criarLote(b, ator, origemDa(req), new Date(), new URL(req.url).origin), 201);
}
