"use client";

import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, ChevronRight, ClipboardCheck, ClipboardX, Eye, FileWarning, FileX, Fuel, Loader2, Pencil, Plus,
  SlidersHorizontal, Truck, UserCog, Users, Wrench, X, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { AlternarVisao, CampoBusca, sugerirPorUrl, ChipResumo, MultiSelect, Paginacao, SelectFiltro, type Opcao } from "@/components/listagem/listagem-ui";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";
import { ChecklistSelo, DocumentoSelo, RevisaoSelo, VeiculoStatusSelo } from "@/components/veiculos/selos";
import type { FiltrosVeiculos, OrdemVeiculos } from "@/lib/veiculo-listagem";
import { ImportarPlanilha } from "@/components/importacao/importar-planilha";

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
  const roteador = useRouter();
  const sugerir = useMemo(() => sugerirPorUrl("/api/listas/sugestoes?lista=veiculos"), []);
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
          <div className="p-2 bg-surface-alt rounded-lg hidden sm:block"><Truck className="w-5 h-5 text-ink-muted" /></div>
          <h1 className="page-title">Veículos</h1>
          <span data-total className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">
            {total.toLocaleString("pt-BR")}
          </span>
          {pendente && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <AlternarVisao visao={visao} onTrocar={trocarVisao} />
          {podeGerenciar && <ImportarPlanilha entidade="veiculos" />}
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
          icone={CheckCircle2} cor="text-ok-texto" rotulo="Em uso" valor={resumo.ativos} />
        <ChipResumo id="manutencao" ativo={f.status === "manutencao"} onClick={() => navegar({ status: f.status === "manutencao" ? null : "manutencao", aviso: null })}
          icone={Wrench} cor="text-atencao-texto" rotulo="Em manutenção" valor={resumo.manutencao} />
        <ChipResumo id="inativos" ativo={f.status === "inativo"} onClick={() => navegar({ status: f.status === "inativo" ? null : "inativo", aviso: null })}
          icone={Ban} cor="text-ink-muted" rotulo="Inativos" valor={resumo.inativos} />
        <ChipResumo id="doc_vencido" ativo={f.aviso === "doc_vencido" || f.aviso === "documentos"} onClick={() => alternarAviso("doc_vencido")}
          icone={FileX} cor="text-atrasado" rotulo="Documento vencido" valor={resumo.docVencido} />
        <ChipResumo id="doc_vencendo" ativo={f.aviso === "doc_vencendo" || f.aviso === "documentos"} onClick={() => alternarAviso("doc_vencendo")}
          icone={FileWarning} cor="text-atencao-texto" rotulo="Documento vencendo" valor={resumo.docVencendo} />
        <ChipResumo id="revisao_vencida" ativo={f.aviso === "revisao_vencida"} onClick={() => alternarAviso("revisao_vencida")}
          icone={Wrench} cor="text-atrasado" rotulo="Revisão vencida" valor={resumo.revisaoVencida} />
        <ChipResumo id="revisao_proxima" ativo={f.aviso === "revisao_proxima"} onClick={() => alternarAviso("revisao_proxima")}
          icone={Wrench} cor="text-atencao-texto" rotulo="Revisão em 30 dias" valor={resumo.revisaoProxima} />
        {resumo.semChecklist != null && (
          <ChipResumo id="sem_checklist" ativo={f.aviso === "sem_checklist"} onClick={() => alternarAviso("sem_checklist")}
            icone={ClipboardX} cor="text-ink-muted" rotulo="Sem checklist hoje" valor={resumo.semChecklist} />
        )}
      </div>

      {/* ── Busca + filtros ── */}
      <div className="bg-white border border-surface-border rounded-card p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_auto] gap-2 items-center">
          <CampoBusca valor={busca} onChange={setBusca} carregando={pendente} sugerir={sugerir} onEscolher={(s) => s.href && roteador.push(s.href)} rotulo="Pesquisar veículo" placeholder="Pesquisar placa, modelo, marca, RENAVAM, responsável ou equipe…" />
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
              <button onClick={limpar} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-atrasado">
                <X className="w-3.5 h-3.5" /> Limpar filtros ({filtrosAtivos})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Resultados ── */}
      <div className={cn("transition-opacity", pendente && "opacity-60")}>
        {itens.length === 0 ? (
          <div className="bg-white border border-surface-border rounded-card text-center py-16">
            <Truck className="w-10 h-10 text-ink-subtle mx-auto mb-3" />
            <p className="text-ink font-medium">{f.q ? `Nenhum veículo encontrado para “${f.q}”` : "Nenhum veículo encontrado"}</p>
            <p className="text-sm text-ink-muted mt-1">{filtrosAtivos > 0 ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro veículo da frota."}</p>
            {filtrosAtivos > 0 && <button onClick={limpar} className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-700">Limpar filtros</button>}
          </div>
        ) : (
          <>
            {/* Celular: lista compacta (sempre) */}
            <div className="md:hidden bg-white border border-surface-border rounded-card divide-y divide-surface-border overflow-hidden" data-visao="mobile">
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
// As larguras somam o que cabe num notebook (1440px com o menu aberto) sem rolar de lado
const COLUNAS: ColunaPro[] = [
  { id: "veiculo", titulo: "Veículo", ordenar: "placa", obrigatoria: true, minimo: 220 },
  { id: "ano", titulo: "Ano", ordenar: "ano", largura: 96 },
  { id: "combustivel", titulo: "Combustível e tipo", largura: 150, classe: "truncate" },
  { id: "responsavel", titulo: "Responsável e equipe", largura: 190 },
  { id: "avisos", titulo: "Avisos", largura: 190 },
  { id: "status", titulo: "Status", largura: 124 },
  // 3 ícones de 28px + respiro
  { id: "acoes", titulo: "Ações", fixa: true, semTitulo: true, largura: 108, alinhar: "direita", classe: "py-0.5" },
];

function Tabela({ massa, itens, f, onOrdenar, podeGerenciar, podeChecklist }: {
  massa: boolean; itens: VeiculoLinha[]; f: FiltrosVeiculos; onOrdenar: (k: OrdemVeiculos) => void; podeGerenciar: boolean; podeChecklist: boolean;
}) {
  const btn = "p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50";
  return (
    <TabelaPro
      tela="veiculos" className="bg-white border border-surface-border rounded-card overflow-hidden" atributos={{ "data-visao": "lista", "data-tabela-veiculos": true }}
      ordenacao={{ ativa: f.ordem, dir: f.dir, onOrdenar: (k) => onOrdenar(k as OrdemVeiculos) }}
      barra={<span>{itens.length === 1 ? "1 veículo nesta página" : `${itens.length} veículos nesta página`}</span>}
      colunas={[
        ...(massa ? [{ id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxPagina />, classe: "pl-3" }] : []),
        ...COLUNAS,
      ]}
      linhas={itens.map((v) => {
        const descricao = [marcaModelo(v), v.cor].filter(Boolean).join(" · ");
        return {
          id: v.id, atributos: { "data-veiculo-id": v.id }, classe: v.status === "INATIVO" ? "opacity-60" : undefined, href: `/veiculos/${v.id}/editar`,
          titulos: { veiculo: [v.placa, descricao].filter(Boolean).join(" · "), combustivel: [v.combustivel, v.tipoLabel].filter(Boolean).join(" · ") },
          celulas: {
            sel: massa ? <CheckboxLinha id={v.id} rotulo={v.placa} /> : null,
            veiculo: (
              <Link href={`/veiculos/${v.id}/editar`} className="flex items-center gap-2 min-w-0 hover:text-primary-600">
                <Miniatura v={v} pequena />
                <span className="min-w-0 truncate">
                  <span data-placa className={PLANILHA.codigo}>{v.placa}</span>
                  {descricao && <span data-marca-modelo className={cn(PLANILHA.apagado, "ml-2")}>{descricao}</span>}
                </span>
              </Link>
            ),
            ano: <span data-ano className={PLANILHA.apagado}>{anoTexto(v) ?? "—"}</span>,
            combustivel: v.combustivel || v.tipoLabel
              ? <span data-combustivel className="inline-flex items-center gap-1 text-ink min-w-0">{v.combustivel && <Fuel className="w-3.5 h-3.5 text-ink-subtle shrink-0" aria-hidden />}<span className="truncate">{[v.combustivel, v.tipoLabel].filter(Boolean).join(" · ")}</span></span>
              : <span className="text-ink-subtle">—</span>,
            responsavel: v.responsavel || v.equipe ? (
              <span className="flex items-center gap-1.5 min-w-0">
                {v.equipe && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: v.equipe.cor }} title={v.equipe.nome} />}
                <span className="truncate text-ink" title={[v.responsavel, v.equipe?.nome].filter(Boolean).join(" · ")}>{[v.responsavel, v.equipe?.nome].filter(Boolean).join(" · ")}</span>
              </span>
            ) : <span className="text-ink-subtle">—</span>,
            avisos: <Avisos v={v} vazio={<span className="text-xs text-ink-subtle">—</span>} />,
            status: <VeiculoStatusSelo status={v.status} />,
            acoes: (
              <span className="inline-flex items-center justify-end gap-0.5" data-acoes-veiculo={v.id}>
                {podeChecklist && v.status !== "INATIVO" && (
                  <Link href={`/veiculos/checklist?veiculoId=${v.id}`} title="Preencher checklist" aria-label={`Preencher o checklist de ${v.placa}`} className={btn} data-checklist-veiculo><ClipboardCheck className="w-4 h-4" aria-hidden /></Link>
                )}
                <Link href={`/veiculos/${v.id}/editar`} title={podeGerenciar ? "Editar" : "Ver ficha"} aria-label={`${podeGerenciar ? "Editar" : "Ver a ficha de"} ${v.placa}`} className={btn} data-abrir-veiculo>
                  {podeGerenciar ? <Pencil className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                </Link>
                <InativarRegistro url={`/api/veiculos/${v.id}`} modulo="veiculos" acaoReativar="gerenciar" ativo={v.status !== "INATIVO"} nome={v.placa} entidade="veículo" />
              </span>
            ),
          },
        };
      })}
    />
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
          className={cn("block h-full group bg-white border border-surface-border rounded-card overflow-hidden hover:shadow-md hover:border-primary-300 transition-all", v.status === "INATIVO" && "opacity-60")}>
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
            <p className="text-xs text-ink-muted truncate flex items-center gap-1.5 pt-2 pr-8 border-t border-surface-border/70">
              {v.equipe ? <><Users className="w-3.5 h-3.5 shrink-0" />{v.equipe.nome}</> : <><UserCog className="w-3.5 h-3.5 shrink-0" />{v.responsavel ?? "Sem responsável"}</>}
            </p>
          </div>
        </Link>
        {/* Fora do link (o modal não navega ao fechar): o mesmo Inativar/Reativar da lista */}
        <span className="absolute bottom-2 right-2" data-acoes-cartao={v.id}>
          <InativarRegistro url={`/api/veiculos/${v.id}`} modulo="veiculos" acaoReativar="gerenciar" ativo={v.status !== "INATIVO"} nome={v.placa} entidade="veículo" />
        </span>
        </div>
      ))}
    </div>
  );
}

/* ───────── Peças ───────── */
function Miniatura({ v, pequena }: { v: VeiculoLinha; pequena?: boolean }) {
  const lado = pequena ? "w-7 h-7 rounded" : "w-12 h-12 rounded-lg";
  if (!v.foto) {
    return <span className={cn(lado, "bg-surface-alt border border-surface-border flex items-center justify-center text-ink-subtle shrink-0")}><Truck className={pequena ? "w-3.5 h-3.5" : "w-5 h-5"} aria-hidden /></span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={v.foto} alt={`${v.placa} — frente`} loading="lazy" decoding="async" width={pequena ? 28 : 48} height={pequena ? 28 : 48} className={cn(lado, "object-cover border border-surface-border shrink-0 bg-surface-alt")} />
  );
}
