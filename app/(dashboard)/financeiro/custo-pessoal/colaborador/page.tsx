import { redirect } from "next/navigation";

/** Sem colaborador escolhido (ex.: link do breadcrumb): volta para a lista do custo de pessoal. */
export default function SemColaborador() {
  redirect("/financeiro/custo-pessoal");
}
