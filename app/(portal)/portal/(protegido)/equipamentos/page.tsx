import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalSession, exigePermissao, gerarQrDataUrl } from "@/lib/portal-server";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { Thermometer, MapPin, Plus, Lock } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Equipamentos" };
export const dynamic = "force-dynamic";

export default async function PortalEquipamentos() {
  const sessao = await requirePortalSession();
  if (!exigePermissao(sessao, "verEquipamentos")) {
    return <SemAcesso />;
  }
  const { user } = sessao;

  const unidades = await prisma.unidade.findMany({
    where: { clienteId: user.clienteId, empresaId: user.empresaId, ativo: true },
    orderBy: [{ principal: "desc" }, { nome: "asc" }],
    include: {
      equipamentos: { where: { ativo: true }, orderBy: { marca: "asc" } },
    },
  });

  const base = process.env.NEXTAUTH_URL || "";
  // Gera QR para cada equipamento
  const qrMap = new Map<string, string>();
  for (const u of unidades) {
    for (const e of u.equipamentos) {
      qrMap.set(e.id, await gerarQrDataUrl(`${base}/portal/equipamentos?eq=${e.id}`));
    }
  }

  const totalEquip = unidades.reduce((acc, u) => acc + u.equipamentos.length, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Thermometer className="w-6 h-6 text-primary-600" /> Equipamentos</h1>

      {totalEquip === 0 && <div className="bg-white rounded-xl border border-surface-border p-10 text-center text-ink-muted">Nenhum equipamento cadastrado.</div>}

      {unidades.filter((u) => u.equipamentos.length > 0).map((u) => (
        <div key={u.id}>
          <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wider flex items-center gap-1.5 mb-3"><MapPin className="w-4 h-4" /> {u.nome}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {u.equipamentos.map((e) => (
              <div key={e.id} className="bg-white rounded-xl border border-surface-border p-4 flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink text-sm">{LABELS_TIPO_EQUIPAMENTO[e.tipo] ?? e.tipo}</p>
                  <p className="text-sm text-ink-muted">{e.marca} {e.modelo}</p>
                  {e.numeroSerie && <p className="text-xs text-ink-subtle">Série: {e.numeroSerie}</p>}
                  {e.localizacao && <p className="text-xs text-ink-subtle">Local: {e.localizacao}</p>}
                  {e.fotos?.[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.fotos[0]} alt={e.modelo} className="mt-2 w-full h-24 object-cover rounded-lg border border-surface-border" />
                  )}
                  {user.permissoes?.abrirChamados && (
                    <Link href="/portal/chamados/novo" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
                      <Plus className="w-3.5 h-3.5" /> Abrir chamado
                    </Link>
                  )}
                </div>
                {qrMap.get(e.id) && (
                  <div className="shrink-0 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrMap.get(e.id)} alt="QR" className="w-16 h-16" />
                    <p className="text-[9px] text-ink-subtle mt-0.5">QR</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SemAcesso() {
  return (
    <div className="bg-white rounded-xl border border-surface-border p-10 text-center">
      <Lock className="w-8 h-8 text-ink-subtle mx-auto mb-2" />
      <p className="text-ink-muted">Você não tem permissão para ver esta seção.</p>
    </div>
  );
}
