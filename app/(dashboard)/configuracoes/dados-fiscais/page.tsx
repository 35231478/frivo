import { redirect } from "next/navigation";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

/** Link de Configurações: abre a tela na gaveta (a página própria é Financeiro › Fiscal). */
export default function Page() {
  redirect(hrefSecaoConfig("dados-fiscais"));
}
