import type { Metadata } from "next";
import { ClienteForm } from "@/components/forms/cliente-form";

export const metadata: Metadata = { title: "Novo Cliente" };

export default function NovoClientePage() {
  return <ClienteForm />;
}
