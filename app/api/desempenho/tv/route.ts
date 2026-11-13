import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa } from "@/lib/desempenho/api";
import { desligarLinkTv, gerarLinkTv, responder } from "@/lib/desempenho/servidor";

/** Gera (ou troca) o link do modo TV: o anterior para de funcionar. "Desempenho › Gerenciar". */
export async function POST() {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  return responder(() => gerarLinkTv(atorDa(guard.session)), 201);
}

/** Desliga o modo TV. */
export async function DELETE() {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  return responder(() => desligarLinkTv(atorDa(guard.session)));
}
