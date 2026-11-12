import { redirect } from "next/navigation";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

/** Link direto: abre a tela na gaveta da página de Configurações. */
export default function Page() {
  redirect(hrefSecaoConfig("orcamento"));
}
