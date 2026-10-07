"use client";

import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, ChevronRight, ClipboardCheck, ClipboardX, FileWarning, FileX, Fuel, Loader2, Pencil, Plus,
  SlidersHorizontal, Truck, UserCog, Users, Wrench, X, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { AlternarVisao, CampoBusca, ChipResumo, MultiSelect, Paginacao, SelectFiltro, ThOrd, type Opcao } from "@/components/listagem/listagem-ui";
import { ChecklistSelo, DocumentoSelo, RevisaoSelo, VeiculoStatusSelo } from "@/components/veiculos/selos";
import type { FiltrosVeiculos, OrdemVeiculos } from "@/lib/veiculo-listagem";

export type VeiculoLinha = {
  id: string;
  placa: string; marca: string | null; modelo: string;
  ano: string | null; anoModelo: string | null; combustivel: string | null; cor: string | null;
  tipo: string; tipoLabel: string; status: string; km: number | null;
  foto: string | null;
  responsavel: string | null; equipe: { nome: string; cor: string } | null;
  documento: { situacao: "vencido" | "vencendo"; nome: string; data: string } | null;
  revisao: { situacao: "vencida" | "proxima"; data: string | null; km: number | null } | null;
  checklistHoje: string | null;
};

interface Props {
  itens: VeiculoLinha[];
  total: number;
  filtros: FiltrosVeiculos;
  tipos: Opcao[];
  resumo: {
    ativos: number; manutencao: number; inativos: number;
    docVencido: number; docVencendo: number; revisaoVencida: number; revisaoProxima: number;
    /** null = a empresa não usa checklist (sem modelo ativo): o indicador não aparece */
    semChecklist: number | null;
  };
}

/** "2022/2023" (fabricação/modelo) ou só um deles. */
function anoTexto(v: Pick<VeiculoLinha, "ano" | "anoModelo">) {
  if (v.ano && v.anoModelo && v.ano !== v.anoModelo) return `${v.ano}/${v.anoModelo}`;
  return v.ano ?? v.anoModelo ?? null;
}
const marcaModelo = (v: Pick<VeiculoLinha, "marca" | "modelo">) => [v.marca, v.modelo].filter(Boolean).join(" ");
/** "2022/2023 · Flex · Carro" */
const detalhes = (v: VeiculoLinha) => [anoTexto(v), v.combustivel, v.tipoLabel].filter(Boolean).join(" · ");

export function VeiculosListaClient({ itens, total, filtros: f, tipos, resumo }: Props) {
  const massa = useAcoesMassaDisponiveis("veiculos");
  const { pode } = usePermissoes();
  const podeGerenciar = pode("veiculos", "gerenciar");
  const podeChecklist = pode("veiculos", "checklist");
  // Mesmo hook da listagem de Equipamentos: URL = fonte da verdade, filtro salvo, visão lista/cards
  const { visao, trocarVisao, busca, setBusca, navegar, limpar, pendente } = useListagemUrl({ chave: "veiculos", qAtual: f.q });
  const [filtrosMobile, setFiltrosMobile] = useState(false);

  function ordenar(k: OrdemVeiculos) {
    const dir = f.ordem === k ? (f.dir === "asc" ? "desc" : "asc") : "asc";
    navegar({ ordem: k === "placa" ? null : k, dir: dir === "asc" ? null : "desc" });
  }
  const filtrosAtivos = [f.q, f.tipos.length, f.status !== "ativo", f.aviso].filter(Boolean).length;
  const alternarAviso = (a: FiltrosVeiculos["aviso"]) => navegar({ aviso: f.aviso === a ? null : a, ...(f.status === "inativo" ? { status: null } : {}) });

  return (
    <div className="space-y-4" data-listagem-veiculos>
      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-2 bg-primary-50 rounded-lg hidden sm:block"><Truck className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Veículos</h1>
          <span data-total className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">
            {total.toLocaleString("pt-BR")}
          </span>
          {pendente && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <AlternarVisao visao={visao} onTrocar={trocarVisao} />
          {podeGerenciar && (
            <Link href="/veiculos/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo veículo</span><span className="sm:hidden">Novo</span>
            </Link>
          )}
        </div>
      </div>

      {/* ── Indicadores da frota (atalhos de filtro) ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" data-indicadores>
        <ChipResumo id="ativos" ativo={f.status === "ativo" && !f.aviso} onClick={() => navegar({ status: null, aviso: null })}
          icone={CheckCircle2} cor="text-emerald-700" rotulo="Em uso" valor={resumo.ativos} />
        <ChipResumo id="manutencao" ativo={f.status === "manutencao"} onClick={() => navegar({ status: f.status === "manutencao" ? null : "manutencao", aviso: null })}
          icone={Wrench} cor="text-amber-700" rotulo="Em manutenção" valor={resumo.manutencao} />
        <ChipResumo id="inativos" ativo={f.status === "inativo"} onClick={() => navegar({ status: f.status === "inativo" ? null : "inativo", aviso: null })}
          icone={Ban} cor="text-slate-500" rotulo="Inativos" valor={resumo.inativos} />
        <ChipResumo id="doc_vencido" ativo={f.aviso === "doc_vencido"} onClick={() => alternarAviso("doc_vencido")}
          icone={FileX} cor="text-red-600" rotulo="Documento vencido" valor={resumo.docVencido} />
        <ChipResumo id="doc_vencendo" ativo={f.aviso === "doc_vencendo"} onClick={() => alternarAviso("doc_vencendo")}
          icone={FileWarning} cor="text-amber-700" rotulo="Documento vencendo" valor={resumo.docVencendo} />
        <ChipResumo id="revisao_vencida" ativo={f.aviso === "revisao_vencida"} onClick={() => alternarAviso("revisao_vencida")}
          icone={Wrench} cor="text-red-600" rotulo="Revisão vencida" valor={resumo.revisaoVencida} />
        <ChipResumo id="revisao_proxima" ativo={f.aviso === "revisao_proxima"} onClick={() => alternarAviso("revisao_proxima")}
          icone={Wrench} cor="text-amber-700" rotulo="Revisão em 30 dias" valor={resumo.revisaoProxima} />
        {resumo.semChecklist != null && (
          <ChipResumo id="sem_checklist" ativo={f.aviso === "sem_checklist"} onClick={() => alternarAviso("sem_checklist")}
            icone={ClipboardX} cor="text-slate-600" rotulo="Sem checklist hoje" valor={resumo.semChecklist} />
        )}
      </div>

      {/* ── Busca + filtros ── */}
      <div className="bg-white border border-surface-border rounded-xl p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_auto] gap-2 items-center">
          <CampoBusca valor={busca} onChange={setBusca} rotulo="Buscar veículo" placeholder="Buscar placa, modelo, marca, RENAVAM, responsável ou equipe…" />
          <button
            onClick={() => setFiltrosMobile((v) => !v)}
            className="lg:hidden w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium text-primary-600 border border-surface-border rounded-lg py-2"
          >
            <SlidersHorizontal className="w-4 h-4" />
            {filtrosMobile ? "Ocultar filtros" : `Filtros${filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ""}`}
          </button>
          <div className={cn("flex-wrap items-center gap-2", filtrosMobile ? "flex" : "hidden lg:flex")}>
            <SelectFiltro
              rotulo="Status" valor={f.status === "ativo" ? "" : f.status} onChange={(v) => navegar({ status: v || null })}
              vazio="Status: em uso" opcoes={[
                { value: "manutencao", label: "Status: em manutenção" }, { value: "inativo", label: "Status: inativos" }, { value: "todos", label: "Status: todos" },
              ]}
            />
            <MultiSelect titulo="Tipo" opcoes={tipos} selecionados={f.tipos} onChange={(v) => navegar({ tipos: v.join(",") || null })} />
            <label className="inline-flex items-center gap-2 text-sm text-ink-muted select-none px-1">
              <input type="checkbox" checked={f.status === "todos"} onChange={(e) => navegar({ status: e.target.checked ? "todos" : null })} className="accent-primary-600" aria-label="Mostrar inativos" />
              Mostrar inativos
            </label>
            {filtrosAtivos > 0 && (
              <button onClick={limpar} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-red-500">
                <X className="w-3.5 h-3.5" /> Limpar filtros ({filtrosAtivos})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Resultados ── */}
      <div className={cn("transition-opacity", pendente && "opacity-60")}>
        {itens.length === 0 ? (
          <div className="bg-white border border-surface-border rounded-xl text-center py-16">
            <Truck className="w-10 h-10 text-ink-subtle mx-auto mb-3" />
            <p className="text-ink font-medium">{f.q ? `Nenhum veículo encontrado para “${f.q}”` : "Nenhum veículo encontrado"}</p>
            <p className="text-sm text-ink-muted mt-1">{filtrosAtivos > 0 ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro veículo da frota."}</p>
            {filtrosAtivos > 0 && <button onClick={limpar} className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-700">Limpar filtros</button>}
          </div>
        ) : (
          <>
            {/* Celular: lista compacta (sempre) */}
            <div className="md:hidden bg-white border border-surface-border rounded-xl divide-y divide-surface-border overflow-hidden" data-visao="mobile">
              {itens.map((v) => (
                <div key={v.id} className="flex items-stretch">
                  {massa && <div className="pl-3 pt-4"><CheckboxLinha id={v.id} rotulo={v.placa} /></div>}
                  <div className="min-w-0 flex-1"><LinhaMobile v={v} /></div>
                </div>
              ))}
            </div>
            {/* Desktop: tabela (padrão) ou cards */}
            <div className="hidden md:block">
              {visao === "lista"
                ? <Tabela massa={massa} itens={itens} f={f} onOrdenar={ordenar} podeGerenciar={podeGerenciar} podeChecklist={podeChecklist} />
                : <Cards massa={massa} itens={itens} />}
            </div>
          </>
        )}
      </div>

      <Paginacao total={total} pagina={f.pagina} porPagina={f.porPagina} onNavegar={navegar} />
    </div>
  );
}

/* ───────── Avisos da linha ───────── */
function Avisos({ v, vazio }: { v: VeiculoLinha; vazio?: React.ReactNode }) {
  // "Sem checklist hoje" fica só no indicador do topo (em toda linha viraria ruído); na linha, só o que pede ação
  const checklistAlerta = v.checklistHoje === "COM_ALERTAS";
  const tem = v.documento || v.revisao || checklistAlerta;
  if (!tem) return <>{vazio ?? null}</>;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {v.documento && <DocumentoSelo doc={v.documento} />}
      {v.revisao && <RevisaoSelo rev={v.revisao} />}
      {checklistAlerta && <ChecklistSelo status="COM_ALERTAS" />}
    </div>
  );
}

/* ───────── Tabela (desktop) ───────── */
function Tabela({ massa, itens, f, onOrdenar, podeGerenciar, podeChecklist }: {
  massa: boolean; itens: VeiculoLinha[]; f: FiltrosVeiculos; onOrdenar: (k: OrdemVeiculos) => void; podeGerenciar: boolean; podeChecklist: boolean;
}) {
  const router = useRouter();
  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-x-auto" data-visao="lista">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt text-ink-muted text-[11px] uppercase tracking-wide border-b border-surface-border">
          <tr>
            {massa && <th className="w-px pl-4 pr-1 py-2.5"><CheckboxPagina /></th>}
            <ThOrd label="Veículo (placa · marca/modelo)" k="placa" ordem={f.ordem} dir={f.dir} onOrdenar={onOrdenar} className={massa ? "pl-2" : "pl-4"} />
            <ThOrd label="Ano" k="ano" ordem={f.ordem} dir={f.dir} onOrdenar={onOrdenar} />
            <th className="text-left px-3 py-2.5 font-semibold">Combustível</th>
            <th className="text-left px-3 py-2.5 font-semibold">Responsável / equipe</th>
            <th className="text-left px-3 py-2.5 font-semibold">Avisos</th>
            <th className="text-left px-3 py-2.5 font-semibold">Status</th>
            <th className="text-right pl-2 pr-3 py-2.5 font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border/70">
          {itens.map((v) => (
            <tr key={v.id} data-veiculo-id={v.id} onClick={() => router.push(`/veiculos/${v.id}/editar`)}
              className={cn("cursor-pointer hover:bg-primary-50/40 transition-colors", v.status === "INATIVO" && "opacity-60")}>
              {massa && <td className="w-px pl-4 pr-1 py-2.5" onClick={(ev) => ev.stopPropagation()}><CheckboxLinha id={v.id} rotulo={v.placa} /></td>}
              <td className={massa ? "pl-2 pr-3 py-2.5" : "pl-4 pr-3 py-2.5"}>
                <div className="flex items-center gap-3 min-w-[220px]">
                  <Miniatura v={v} />
                  <div className="min-w-0">
                    <p data-placa className="font-mono font-bold text-ink tracking-wide">{v.placa}</p>
                    <p data-marca-modelo className="text-xs text-ink-muted truncate max-w-[260px]">{marcaModelo(v) || "—"}{v.cor ? ` · ${v.cor}` : ""}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-ink" data-ano>{anoTexto(v) ?? <span className="text-ink-subtle">—</span>}</td>
              <td className="px-3 py-2.5 whitespace-nowrap" data-combustivel>
                {v.combustivel ? <span className="inline-flex items-center gap-1 text-ink"><Fuel className="w-3.5 h-3.5 text-ink-subtle" />{v.combustivel}</span> : <span className="text-ink-subtle">—</span>}
                <p className="text-[11px] text-ink-subtle">{v.tipoLabel}</p>
              </td>
              <td className="px-3 py-2.5 max-w-[220px]">
                {v.responsavel || v.equipe ? (
                  <>
                    {v.responsavel && <p className="text-ink truncate flex items-center gap-1"><UserCog className="w-3.5 h-3.5 text-ink-subtle shrink-0" />{v.responsavel}</p>}
                    {v.equipe && <p className="text-xs text-ink-muted truncate flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: v.equipe.cor }} />{v.equipe.nome}</p>}
                  </>
                ) : <span className="text-ink-subtle">—</span>}
              </td>
              <td className="px-3 py-2.5"><Avisos v={v} vazio={<span className="text-xs text-ink-subtle">—</span>} /></td>
              <td className="px-3 py-2.5"><VeiculoStatusSelo status={v.status} /></td>
              <td className="pl-2 pr-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                <div className="flex items-center justify-end gap-0.5">
                  {podeChecklist && v.status !== "INATIVO" && (
                    <Link href={`/veiculos/checklist?veiculoId=${v.id}`} title="Preencher checklist" className="p-1 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><ClipboardCheck className="w-4 h-4" /></Link>
                  )}
                  <Link href={`/veiculos/${v.id}/editar`} title={podeGerenciar ? "Editar" : "Ver ficha"} className="p-1 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><Pencil className="w-4 h-4" /></Link>
                  <InativarRegistro url={`/api/veiculos/${v.id}`} modulo="veiculos" acaoReativar="gerenciar" ativo={v.status !== "INATIVO"} nome={v.placa} entidade="veículo" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── Celular ───────── */
function LinhaMobile({ v }: { v: VeiculoLinha }) {
  return (
    <Link href={`/veiculos/${v.id}/editar`} data-veiculo-id={v.id} className={cn("flex items-start gap-3 p-3 active:bg-surface-alt", v.status === "INATIVO" && "opacity-60")}>
      <Miniatura v={v} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p data-placa className="font-mono font-bold text-ink tracking-wide leading-tight">{v.placa}</p>
          <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" />
        </div>
        <p className="text-sm text-ink truncate">{marcaModelo(v) || "—"}</p>
        <p data-detalhes className="text-xs text-ink-muted truncate">{detalhes(v)}</p>
        {(v.responsavel || v.equipe) && <p className="text-xs text-ink-subtle truncate">{[v.responsavel, v.equipe?.nome].filter(Boolean).join(" · ")}</p>}
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {v.status !== "ATIVO" && <VeiculoStatusSelo status={v.status} />}
          <Avisos v={v} />
        </div>
      </div>
    </Link>
  );
}

/* ───────── Cards (desktop, alternativo) ───────── */
function Cards({ massa, itens }: { massa: boolean; itens: VeiculoLinha[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4" data-visao="cards">
      {itens.map((v) => (
        <div key={v.id} className="relative">
        {massa && <CheckboxLinha id={v.id} rotulo={v.placa} className="absolute top-2 left-2 z-10 bg-white rounded p-1.5 m-0 shadow-sm" />}
        <Link href={`/veiculos/${v.id}/editar`} data-veiculo-id={v.id}
          className={cn("block h-full group bg-white border border-surface-border rounded-xl overflow-hidden hover:shadow-md hover:border-primary-300 transition-all", v.status === "INATIVO" && "opacity-60")}>
          <div className="aspect-[16/9] bg-surface-alt overflow-hidden relative">
            {v.foto
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={v.foto} alt={`${v.placa} — frente`} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              : <div className="w-full h-full flex items-center justify-center text-ink-subtle"><Truck className="w-10 h-10" /></div>}
            <VeiculoStatusSelo status={v.status} className="absolute top-2 right-2 shadow-sm" />
          </div>
          <div className="p-3.5 space-y-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 data-placa className="font-mono font-bold text-ink tracking-wide group-hover:text-primary-600">{v.placa}</h3>
                <span className="text-xs text-ink-muted">{v.tipoLabel}</span>
              </div>
              <p data-marca-modelo className="text-sm text-ink truncate">{marcaModelo(v) || "—"}</p>
              <p data-detalhes className="text-xs text-ink-muted truncate">{[anoTexto(v), v.combustivel, v.cor].filter(Boolean).join(" · ") || "—"}</p>
            </div>
            <Avisos v={v} />
            <p className="text-xs text-ink-muted truncate flex items-center gap-1.5 pt-2 border-t border-surface-border/70">
              {v.equipe ? <><Users className="w-3.5 h-3.5 shrink-0" />{v.equipe.nome}</> : <><UserCog className="w-3.5 h-3.5 shrink-0" />{v.responsavel ?? "Sem responsável"}</>}
            </p>
          </div>
        </Link>
        </div>
      ))}
    </div>
  );
}

/* ───────── Peças ───────── */
function Miniatura({ v }: { v: VeiculoLinha }) {
  if (!v.foto) {
    return <span className="w-12 h-12 rounded-lg bg-surface-alt border border-surface-border flex items-center justify-center text-ink-subtle shrink-0"><Truck className="w-5 h-5" /></span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={v.foto} alt={`${v.placa} — frente`} loading="lazy" decoding="async" width={48} height={48} className="w-12 h-12 rounded-lg object-cover border border-surface-border shrink-0 bg-surface-alt" />
  );
}
