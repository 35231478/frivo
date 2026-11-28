import { redirect } from "next/navigation";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

/** Endereço direto: abre a tela na gaveta da página de Configurações. */
export default function Page() {
  redirect(hrefSecaoConfig("motivos-pausa"));
}
