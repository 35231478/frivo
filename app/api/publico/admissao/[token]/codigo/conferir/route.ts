import { NextRequest } from "next/server";
import { conferirCodigoEmail } from "@/lib/admissao/admissao-server";
import { corpo, responderPublico } from "@/lib/admissao/admissao-rotas";

/** Confere o código do e-mail. Errou demais, o código morre: é preciso pedir outro. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await corpo(req);
  return responderPublico(req, () => conferirCodigoEmail(
    token, typeof b.email === "string" ? b.email : "", typeof b.codigo === "string" ? b.codigo : "",
  ));
}
