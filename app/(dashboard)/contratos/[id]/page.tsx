import { redirect } from "next/navigation";

// Não há página de visualização dedicada do contrato — abrir direto a edição.
export default async function ContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/contratos/${id}/editar`);
}
