import type { Metadata } from "next";
import { SecaoConfiguracoes } from "@/components/config/secao-configuracoes";

export const metadata: Metadata = { title: "Configurações operacionais" };

export default function Page() {
  return <SecaoConfiguracoes id="operacionais" />;
}
