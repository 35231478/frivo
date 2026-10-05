import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import Link from "next/link";
import { Camera, Sparkles } from "lucide-react";
import { EquipamentoForm } from "@/components/forms/equipamento-form";

export const metadata: Metadata = { title: "Novo Equipamento" };

export default async function NovoEquipamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ unidadeId?: string }>;
}) {
  const { unidadeId } = await searchParams;
  const session = await auth();
  // Sem permissão de criar: volta para a listagem (o botão "Novo" já fica oculto).
  if (!pode(session?.user?.permissoes, "equipamentos", "criar", session?.user?.role)) redirect("/equipamentos");
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Link
        href="/equipamentos/novo/foto" data-atalho-foto
        className="flex items-center gap-3 p-3 sm:p-4 rounded-xl border border-primary-200 bg-gradient-to-r from-primary-50 to-white hover:border-primary-300 transition-colors"
      >
        <span className="p-2.5 rounded-lg bg-primary-500 text-white shrink-0"><Camera className="w-5 h-5" /></span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-semibold text-ink"><Sparkles className="w-4 h-4 text-primary-500" /> Cadastrar pela foto da etiqueta</span>
          <span className="block text-xs text-ink-muted">Tire uma foto e a IA preenche marca, modelo, capacidade, tensão, gás… Você confere antes de salvar.</span>
        </span>
      </Link>
      <EquipamentoForm unidadeIdFixo={unidadeId} />
    </div>
  );
}
