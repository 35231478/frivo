import { NextRequest } from "next/server";
import { pedirAceite } from "@/lib/os/aceite-server";
import { guardaDoAceite, responderAceite } from "@/lib/os/aceite-rotas";

/**
 * "Enviar ao cliente": UM clique manda o link de confirmação — o e-mail sai pelo envio da empresa e
 * a resposta traz o WhatsApp com a mensagem pronta. A confirmação fica pendente no portal do cliente.
 * Exige "OS › Editar" (o técnico do app dispara nas OS dele) e a OS concluída.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoAceite(id, "editar");
  if (!ator) return resposta;
  return responderAceite(() => pedirAceite(ator, id, new URL(req.url).origin));
}
