import { redirect } from "next/navigation";
import { hrefAbaConfig } from "@/lib/navegacao/configuracoes";

/** Link antigo: a aba na página de Configurações. */
export default function Page() {
  redirect(hrefAbaConfig("conta"));
}
