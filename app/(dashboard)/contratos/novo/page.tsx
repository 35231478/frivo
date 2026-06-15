import type { Metadata } from "next";
import { Suspense } from "react";
import { ContratoForm } from "@/components/forms/contrato-form";

export const metadata: Metadata = { title: "Novo Contrato" };

export default function NovoContratoPage() {
  return (
    <Suspense>
      <ContratoForm />
    </Suspense>
  );
}
