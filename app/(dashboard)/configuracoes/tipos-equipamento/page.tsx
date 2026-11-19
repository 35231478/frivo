import { redirect } from "next/navigation";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

/** Link antigo: abre a mesma tela na gaveta da página de Configurações. */
export default async function Page() {
  // Equipamentos desligado: os tipos de equipamento vão junto (são parte do módulo)
  await exigirModuloNaPagina("equipamentos");
  redirect(hrefSecaoConfig("tipos-equipamento"));
}
