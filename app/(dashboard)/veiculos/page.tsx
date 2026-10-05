import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarData } from "@/lib/utils";
import Link from "next/link";
import { Truck, Plus, UserCog, AlertTriangle, Wrench, Search, X } from "lucide-react";
import { InativarRegistro } from "@/components/ui/inativar-registro";

export const metadata: Metadata = { title: "Veículos" };

const LABEL_TIPO: Record<string, string> = { CARRO: "Carro", VAN: "Van", MOTO: "Moto", CAMINHAO: "Caminhão", OUTRO: "Outro" };
const BADGE_STATUS: Record<string, string> = {
  ATIVO: "bg-success-50 text-success-700",
  INATIVO: "bg-surface-alt text-ink-muted",
  MANUTENCAO: "bg-amber-50 text-amber-700",
};
const LABEL_STATUS: Record<string, string> = { ATIVO: "Ativo", INATIVO: "Inativo", MANUTENCAO: "Em manutenção" };

export default async function VeiculosPage({ searchParams }: { searchParams: Promise<{ inativos?: string; q?: string }> }) {
  const sp = await searchParams;
  const mostrarInativos = sp.inativos === "1";
  const busca = (sp.q ?? "").trim().slice(0, 80);
  // Placa com ou sem hífen ("ABC-1234" / "abc1234") e demais campos sem diferenciar maiúsculas
  const placaBusca = busca.replace(/[^a-z0-9]/gi, "");
  const variantesPlaca = [...new Set([busca, placaBusca, placaBusca.length > 3 ? `${placaBusca.slice(0, 3)}-${placaBusca.slice(3)}` : ""].filter(Boolean))];
  const contem = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const agora = Date.now();

  const veiculos = await prisma.veiculo.findMany({
    // Inativado (status INATIVO) fica fora da lista padrão
    where: {
      empresaId,
      ...(mostrarInativos ? {} : { status: { not: "INATIVO" as const } }),
      ...(busca && {
        OR: [
          ...variantesPlaca.map((v) => ({ placa: contem(v) })),
          { modelo: contem(busca) },
          { marca: contem(busca) },
          { renavam: contem(busca) },
          { responsavel: { nome: contem(busca) } },
          { equipe: { nome: contem(busca) } },
        ],
      }),
    },
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

      <form method="get" className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search" name="q" defaultValue={busca} aria-label="Buscar veículo"
            placeholder="Buscar por placa, modelo, marca, responsável ou equipe"
            className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-ink-muted select-none">
          <input type="checkbox" name="inativos" value="1" defaultChecked={mostrarInativos} className="accent-primary-600" />
          Mostrar inativos
        </label>
        <button type="submit" className="text-sm font-semibold text-primary-600 hover:text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-50">Buscar</button>
        {busca && (
          <Link href={mostrarInativos ? "/veiculos?inativos=1" : "/veiculos"} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <X className="w-3.5 h-3.5" /> Limpar busca
          </Link>
        )}
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {veiculos.length === 0 ? (
          <p className="text-ink-subtle col-span-full text-center py-12">{busca ? `Nenhum veículo encontrado para “${busca}”.` : "Nenhum veículo cadastrado."}</p>
        ) : (
          veiculos.map((v) => {
            const docAlerta = v.documentos.some((d) => d.dataVencimento && new Date(d.dataVencimento).getTime() <= agora + 30 * 864e5);
            const seguroAlerta = v.seguroVencimento && new Date(v.seguroVencimento).getTime() <= agora + 30 * 864e5;
            const revisaoAlerta = v.proximaRevisaoData && new Date(v.proximaRevisaoData).getTime() <= agora + 30 * 864e5;
            return (
              <div key={v.id} data-card-id={v.id} className="relative">
              <Link href={`/veiculos/${v.id}/editar`} className={`block h-full bg-white border border-surface-border rounded-xl overflow-hidden hover:border-primary-300 hover:shadow-card-hover transition-all ${v.status === "INATIVO" ? "opacity-70" : ""}`}>
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
              <div className="absolute bottom-2 right-2 bg-white/90 rounded-md">
                <InativarRegistro url={`/api/veiculos/${v.id}`} modulo="veiculos" acaoReativar="gerenciar" ativo={v.status !== "INATIVO"} nome={v.placa} entidade="veículo" />
              </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
