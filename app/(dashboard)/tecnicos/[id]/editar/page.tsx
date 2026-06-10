import { redirect } from "next/navigation";

export default async function EditarTecnicoRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/colaboradores/${id}/editar`);
}
