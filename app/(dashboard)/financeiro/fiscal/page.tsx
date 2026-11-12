import type { Metadata } from "next";
import { TelaDadosFiscais } from "@/components/config/telas/dados-fiscais";

export const metadata: Metadata = { title: "Dados fiscais" };

/** Financeiro › Fiscal: a mesma tela da gaveta de Configurações (quem é do Financeiro nem sempre vê Configurações). */
export default function DadosFiscaisPage() {
  return <TelaDadosFiscais voltar="/financeiro" />;
}
