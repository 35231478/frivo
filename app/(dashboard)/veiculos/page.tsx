import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarData } from "@/lib/utils";
import Link from "next/link";
import { Truck, Plus, UserCog, AlertTriangle, Wrench } from "lucide-react";

export const metadata: Metadata = { title: "Veículos" };

const LABEL_TIPO: Record<string, string> = { CARRO: "Carro", VAN: "Van", MOTO: "Moto", CAMINHAO: "Caminhão", OUTRO: "Outro" };
const BADGE_STATUS: Record<string, string> = {
  ATIVO: "bg-success-50 text-success-700",
  INATIVO: "bg-surface-alt text-ink-muted",
  MANUTENCAO: "bg-amber-50 text-amber-700",
};
const LABEL_STATUS: Record<string, string> = { ATIVO: "Ativo", INATIVO: "Inativo", MANUTENCAO: "Em manutenção" };

export default async function VeiculosPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const agora = Date.now();

  const veiculos = await prisma.veiculo.findMany({
    where: { empresaId },
    include: {
      responsavel: { select: { nome: true } },
      equipe: { select: { nome: true, cor: true } },
      documentos: { select: { dataVencimento: true } },
    },
    orderBy: { placa: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Truck className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Veículos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{veiculos.length}</span>
        </div>
        <Link href="/veiculos/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
          <Plus className="w-4 h-4" /> Novo Veículo
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {veiculos.length === 0 ? (
          <p className="text-ink-subtle col-span-full text-center py-12">Nenhum veículo cadastrado.</p>
        ) : (
          veiculos.map((v) => {
            const docAlerta = v.documentos.some((d) => d.dataVencimento && new Date(d.dataVencimento).getTime() <= agora + 30 * 864e5);
            const seguroAlerta = v.seguroVencimento && new Date(v.seguroVencimento).getTime() <= agora + 30 * 864e5;
            const revisaoAlerta = v.proximaRevisaoData && new Date(v.proximaRevisaoData).getTime() <= agora + 30 * 864e5;
            return (
              <Link key={v.id} href={`/veiculos/${v.id}/editar`} className="bg-white border border-surface-border rounded-xl overflow-hidden hover:border-primary-300 hover:shadow-card-hover transition-all">
                <div className="aspect-video bg-surface-alt relative">
                  {v.fotos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.fotos[0]} alt={v.placa} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink-subtle"><Truck className="w-10 h-10" /></div>
                  )}
                  <span className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${BADGE_STATUS[v.status]}`}>{LABEL_STATUS[v.status]}</span>
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-ink">{v.placa}</span>
                    <span className="text-xs text-ink-muted">{LABEL_TIPO[v.tipo]}</span>
                  </div>
                  <p className="text-sm text-ink-muted mt-0.5 truncate">{[v.marca, v.modelo, v.ano].filter(Boolean).join(" · ") || "—"}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs text-ink-muted flex-wrap">
                    {v.responsavel && <span className="flex items-center gap-1"><UserCog className="w-3.5 h-3.5" />{v.responsavel.nome}</span>}
                    {v.equipe && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.equipe.cor }} />{v.equipe.nome}</span>}
                  </div>
                  {(docAlerta || seguroAlerta || revisaoAlerta) && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {(docAlerta || seguroAlerta) && <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" /> Documento vencendo</span>}
                      {revisaoAlerta && <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full"><Wrench className="w-3 h-3" /> Revisão {formatarData(v.proximaRevisaoData)}</span>}
                    </div>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
