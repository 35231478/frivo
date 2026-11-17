import { type NextRequest } from "next/server";
import { enviarEmailDoEnvio } from "@/lib/documentacao/pacote-server";
import { corpo, guardaDeEnvio, responderEnvio } from "@/lib/documentacao/pacote-rotas";

type Params = { params: Promise<{ id: string }> };

/**
 * Manda (ou manda de novo) o e-mail de um pacote já montado. O corpo leva o LINK, nunca anexo.
 * Sem destinatário informado, valem os contatos do cadastro do cliente DESTE envio.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const { id } = await params;
  const b = await corpo(req);
  return responderEnvio(() => enviarEmailDoEnvio(
    id, { para: b.para, cc: b.cc, copiaParaMim: b.copiaParaMim === true, validadeDias: b.validadeDias },
    ator, new Date(), new URL(req.url).origin,
  ));
}
