"use client";

import { useRouter } from "next/navigation";
import { ImportarPlanilha } from "@/components/importacao/importar-planilha";

/** Botão de importação na lista de clientes (página servidor): ao concluir, recarrega a lista. */
export function ImportarClientes({ className }: { className?: string }) {
  const router = useRouter();
  return <ImportarPlanilha entidade="clientes" onConcluido={() => router.refresh()} className={className} />;
}
