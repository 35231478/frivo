import { redirect } from "next/navigation";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

// O módulo "Formulários por tipo" foi incorporado ao cadastro de Tipo de Equipamento
// (aba "Formulários"). Mantemos um redirecionamento para não quebrar links antigos.
export default function FormulariosPorTipoPage() {
  redirect(hrefSecaoConfig("tipos-equipamento"));
}
