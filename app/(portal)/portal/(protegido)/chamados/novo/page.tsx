import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalSession } from "@/lib/portal-server";
import { ChamadoForm } from "@/components/portal/chamado-form";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Novo Chamado" };
export const dynamic = "force-dynamic";

export default async function NovoChamadoPage() {
  const { user } = await requirePortalSession();
  if (!user.permissoes?.abrirChamados) redirect("/portal/chamados");

  const [unidades, equipamentos, tipos] = await Promise.all([
    prisma.unidade.findMany({ where: { clienteId: user.clienteId, empresaId: user.empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.equipamento.findMany({ where: { empresaId: user.empresaId, ativo: true, unidade: { clienteId: user.clienteId } }, select: { id: true, marca: true, modelo: true, tipo: true, localizacao: true, unidadeId: true }, orderBy: { marca: "asc" } }),
    prisma.tipoProblema.findMany({ where: { empresaId: user.empresaId, ativo: true }, select: { nome: true }, orderBy: { nome: "asc" } }),
  ]);

  return (
    <div className="space-y-5 max-w-2xl">
      <Link href="/portal/chamados" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-primary-600"><ChevronLeft className="w-4 h-4" /> Voltar</Link>
      <h1 className="text-2xl font-bold text-ink">Abrir novo chamado</h1>
      <ChamadoForm
        unidades={unidades}
        equipamentos={equipamentos.map((e) => ({ id: e.id, unidadeId: e.unidadeId, nome: `${LABELS_TIPO_EQUIPAMENTO[e.tipo] ?? e.tipo} — ${e.marca} ${e.modelo}${e.localizacao ? ` (${e.localizacao})` : ""}` }))}
        tiposProblema={tipos.map((t) => t.nome)}
      />
    </div>
  );
}
