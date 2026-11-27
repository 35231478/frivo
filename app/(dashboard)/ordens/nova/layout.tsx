import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";

/**
 * A tela de abrir OS é de cliente (formulário interativo), então a permissão é conferida aqui, no
 * servidor, antes de ela carregar. Sem "OS › Criar": volta para a lista (o botão "Nova OS" já fica
 * oculto e a rota de gravação também recusa) — o mesmo de Novo cliente e Novo orçamento.
 */
export default async function NovaOsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!pode(session?.user?.permissoes, "ordens", "criar", session?.user?.role)) redirect("/ordens");
  return <>{children}</>;
}
