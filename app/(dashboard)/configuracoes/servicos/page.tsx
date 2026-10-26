import { redirect } from "next/navigation";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

/** Link antigo: abre a mesma tela na gaveta da página de Configurações. */
export default function Page() {
  redirect(hrefSecaoConfig("servicos"));
}
