import type { Metadata } from "next";
import { SecaoConfiguracoes } from "@/components/config/secao-configuracoes";

export const metadata: Metadata = { title: "Configurações financeiras" };

export default function Page() {
  return <SecaoConfiguracoes id="financeiras" />;
}
