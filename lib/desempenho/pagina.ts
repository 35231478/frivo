/** DESEMPENHO — o que as páginas do painel leem da sessão: o que a pessoa pode fazer no módulo. */
import type { Session } from "next-auth";
import { pode, type Permissoes } from "@/lib/permissoes";

export function podeNoDesempenho(session: Session | null) {
  const u = session!.user!;
  const tem = (acao: "visualizar" | "revisar" | "gerenciar") => pode(u.permissoes as Permissoes, "desempenho", acao, u.role);
  return { visualizar: tem("visualizar"), revisar: tem("revisar"), gerenciar: tem("gerenciar") };
}
