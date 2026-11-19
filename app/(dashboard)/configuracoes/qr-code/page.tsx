import { redirect } from "next/navigation";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

/** Link antigo: abre a mesma tela na gaveta da página de Configurações. */
export default async function Page() {
  // QR Codes desligado: a configuração da página pública do QR vai junto
  await exigirModuloNaPagina("qrcodes");
  redirect(hrefSecaoConfig("qr-code"));
}
