import type { Metadata } from "next";
import { ContratoForm } from "@/components/forms/contrato-form";

export const metadata: Metadata = { title: "Novo Contrato" };

export default function NovoContratoPage() {
  return <ContratoForm />;
}
