import { type NextRequest } from "next/server";
import { contratosDoCliente, emailsSugeridos, sugerirColaboradores } from "@/lib/documentacao/pacote-server";
import { guardaDeEnvio, responderEnvio } from "@/lib/documentacao/pacote-rotas";

/**
 * Quem atende o cliente (técnicos fixos dos contratos ativos, quem executou OS dele no último ano)
 * ou os membros de uma equipe — a lista que a tela já traz marcada — e os e-mails do cadastro.
 * É sugestão: o pacote leva quem a pessoa marcar.
 */
export async function GET(req: NextRequest) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const q = req.nextUrl.searchParams;
  const clienteId = q.get("clienteId");
  return responderEnvio(async () => ({
    colaboradores: await sugerirColaboradores(ator.empresaId, {
      clienteId, contratoId: q.get("contratoId"), equipeId: q.get("equipeId"),
    }),
    // os e-mails e os contratos só depois de o cliente ter sido conferido como da empresa (acima)
    email: clienteId ? await emailsSugeridos(clienteId) : { para: [], cc: [] },
    contratos: clienteId ? await contratosDoCliente(ator.empresaId, clienteId) : [],
  }));
}
