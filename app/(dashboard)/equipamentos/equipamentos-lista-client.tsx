"use client";

import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ambienteEquipamento, descricaoEquipamento, fabricanteModelo } from "@/lib/equipamento-descricao";
import { cn, formatarData } from "@/lib/utils";
import { Camera,
  Plus, X, ChevronDown, ChevronRight,
  Eye, Pencil, QrCode, Loader2, SlidersHorizontal,
  Building2, MapPin, ShieldAlert, ShieldX, CheckCircle2, CalendarCheck, Thermometer,
} from "lucide-react";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { EquipamentoAtivoBotao } from "@/components/equipamentos/equipamento-ativo-botao";
import { TipoIcone } from "@/components/equipamentos/tipo-equipamento";
import { GarantiaSelo, StatusSelo } from "@/components/equipamentos/selos";
import type { FiltrosListagem, OrdemListagem } from "@/lib/equipamento-listagem";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { AlternarVisao, CampoBusca, sugerirPorUrl, ChipResumo, MultiSelect, Paginacao, SelectFiltro } from "@/components/listagem/listagem-ui";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";

export type EquipLinha = {
  id: string;
  nome: string; temNome: boolean; marca: string; modelo: string;
  numeroSerie: string | null; patrimonio: string | null;
  tipo: string; tipoLabel: string; capacidade: string | null;
  setor: string | null; ambiente: string | null;
  garantiaAte: string | null; ativo: boolean; qrcodeId: string | null;
  foto: string | null;
  clienteId: string; cliente: string; unidadeId: string; unidade: string;
  ultimoAtendimento: string | null;
};

interface Props {
  itens: EquipLinha[];
  total: number;
  filtros: FiltrosListagem;
  opcoes: { clientes: OpcaoBusca[]; unidades: OpcaoBusca[]; setores: string[]; fluidos: string[]; tipos: OpcaoBusca[] };
  resumo: { ativos: number; vencendo: number; vencidas: number; semQr: number };
}

function haQuanto(iso: string | null) {
  if (!iso) return null;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias < 30) return `há ${dias} d`;
  if (dias < 365) return `há ${Math.floor(dias / 30)} mês${Math.floor(dias / 30) > 1 ? "es" : ""}`;
  const anos = Math.floor(dias / 365);
  return `há ${anos} ano${anos > 1 ? "s" : ""}`;
}

/** "S/N … · TAG …" (o que houver). */
function identificadores(e: Pick<EquipLinha, "numeroSerie" | "patrimonio">) {
  return [e.numeroSerie && `S/N ${e.numeroSerie}`, e.patrimonio && `TAG ${e.patrimonio}`].filter(Boolean).join(" · ");
}

/** "Unidade · Setor · Ambiente" (o que houver). */
/** "Recepção · 2º andar" — ambiente primeiro, setor como complemento. */
function ambienteTexto(e: Pick<EquipLinha, "setor" | "ambiente">): string | null {
  const a = ambienteEquipamento(e);
  return a.principal ? [a.principal, a.complemento].filter(Boolean).join(" · ") : null;
}

export function EquipamentosListaClient({ itens, total, filtros: f, opcoes, resumo }: Props) {
  const massa = useAcoesMassaDisponiveis("equipamentos");
  const { pode } = usePermissoes();
  const podeCriar = pode("equipamentos", "criar");
  const podeEditar = pode("equipamentos", "editar");
  // URL = fonte da verdade; filtros salvos e visão lista/cards (mesmo hook da listagem de Veículos)
  const { visao, trocarVisao, busca, setBusca, navegar, limpar, pendente } = useListagemUrl({ chave: "equipamentos", qAtual: f.q });
  const roteador = useRouter();
  const sugerir = useMemo(() => sugerirPorUrl("/api/listas/sugestoes?lista=equipamentos"), []);
  const [maisAberto, setMaisAberto] = useState(!!(f.qr || f.fluido));
  const [filtrosMobile, setFiltrosMobile] = useState(false);

  function ordenar(k: OrdemListagem) {
    const dir = f.ordem === k ? (f.dir === "asc" ? "desc" : "asc") : (k === "ultimo" ? "desc" : "asc");
    navegar({ ordem: k === "nome" ? null : k, dir: dir === "asc" ? null : "desc" });
  }

  const filtrosAtivos = [f.q, f.cliente, f.unidade, f.setor, f.tipos.length, f.status !== "ativo", f.garantia, f.qr, f.fluido].filter(Boolean).length;
  const clienteSel = opcoes.clientes.find((c) => c.value === f.cliente);
  const unidadeSel = opcoes.unidades.find((u) => u.value === f.unidade);

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-2 bg-surface-alt rounded-lg hidden sm:block"><Thermometer className="w-5 h-5 text-ink-muted" /></div>
          <h1 className="page-title">Equipamentos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">
            {total.toLocaleString("pt-BR")}
          </span>
          {pendente && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <AlternarVisao visao={visao} onTrocar={trocarVisao} />
          {podeCriar && (
            <Link href="/equipamentos/novo/foto" title="Cadastrar pela foto da etiqueta" aria-label="Cadastrar pela foto da etiqueta" data-novo-por-foto className="inline-flex items-center gap-2 border border-primary-300 text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all">
              <Camera className="w-4 h-4" /> <span className="hidden sm:inline">Por foto</span>
            </Link>
          )}
          {podeCriar && (
            <Link href={`/equipamentos/novo${f.unidade ? `?unidadeId=${f.unidade}` : ""}`} data-novo-equipamento className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo equipamento</span><span className="sm:hidden">Novo</span>
            </Link>
          )}
        </div>
      </div>

      {/* ── Resumo do parque (atalhos de filtro) ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <ChipResumo
          ativo={!f.garantia && !f.qr} onClick={() => navegar({ garantia: null, qr: null })}
          icone={CheckCircle2} cor="text-ok-texto" rotulo="Ativos" valor={resumo.ativos}
        />
        <ChipResumo
          ativo={f.garantia === "vencendo"} onClick={() => navegar({ garantia: f.garantia === "vencendo" ? null : "vencendo" })}
          icone={ShieldAlert} cor="text-atencao-texto" rotulo="Garantia vencendo" valor={resumo.vencendo}
        />
        <ChipResumo
          ativo={f.garantia === "vencida"} onClick={() => navegar({ garantia: f.garantia === "vencida" ? null : "vencida" })}
          icone={ShieldX} cor="text-atrasado" rotulo="Garantia vencida" valor={resumo.vencidas}
        />
        <ChipResumo
          ativo={f.qr === "sem"} onClick={() => navegar({ qr: f.qr === "sem" ? null : "sem" })}
          icone={QrCode} cor="text-ink-muted" rotulo="Sem QR" valor={resumo.semQr}
        />
      </div>

      {/* ── Busca + filtros ── */}
      <div className="bg-white border border-surface-border rounded-card p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <CampoBusca valor={busca} onChange={setBusca} carregando={pendente} sugerir={sugerir} onEscolher={(s) => s.href && roteador.push(s.href)} placeholder="Pesquisar nome, modelo, marca, nº série, TAG, cliente, setor…" />
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-ink-subtle shrink-0 hidden sm:block" />
            <BuscaSelect
              className="flex-1 min-w-0"
              value={f.cliente}
              onChange={(v) => navegar({ cliente: v || null, unidade: null, setor: null })}
              options={opcoes.clientes}
              placeholder="Todos os clientes"
            />
          </div>
          <div className={cn("items-center gap-2", filtrosMobile ? "flex" : "hidden lg:flex")}>
            <MapPin className="w-4 h-4 text-ink-subtle shrink-0 hidden sm:block" />
            {f.cliente ? (
              <BuscaSelect
                className="flex-1 min-w-0"
                value={f.unidade}
                onChange={(v) => navegar({ unidade: v || null, setor: null })}
                options={opcoes.unidades}
                placeholder="Todas as unidades"
              />
            ) : (
              <div className="flex-1 bg-surface-alt border border-surface-border rounded-lg px-3 py-2 text-sm text-ink-subtle cursor-not-allowed" title="Escolha um cliente para filtrar por unidade">
                Escolha um cliente…
              </div>
            )}
          </div>
        </div>

        {/* Celular: filtros secundários ficam atrás de um botão */}
        <button
          onClick={() => setFiltrosMobile((v) => !v)}
          className="lg:hidden w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium text-primary-600 border border-surface-border rounded-lg py-2"
        >
          <SlidersHorizontal className="w-4 h-4" />
          {filtrosMobile ? "Ocultar filtros" : `Filtros${filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ""}`}
        </button>

        <div className={cn("flex-wrap items-center gap-2", filtrosMobile ? "flex" : "hidden lg:flex")}>
          <SelectFiltro
            valor={f.setor} onChange={(v) => navegar({ setor: v || null })}
            vazio="Setor: todos" opcoes={opcoes.setores.map((s) => ({ value: s, label: s }))}
          />
          <MultiSelect titulo="Tipo" opcoes={opcoes.tipos} selecionados={f.tipos} onChange={(v) => navegar({ tipos: v.join(",") || null })} icone={(t) => <TipoIcone tipo={t} tamanho="sm" className="w-6 h-6" />} />
          <SelectFiltro
            valor={f.status === "ativo" ? "" : f.status} onChange={(v) => navegar({ status: v || null })}
            vazio="Status: ativos" opcoes={[{ value: "inativo", label: "Status: inativos" }, { value: "todos", label: "Status: todos" }]}
          />
          <SelectFiltro
            valor={f.garantia} onChange={(v) => navegar({ garantia: v || null })}
            vazio="Garantia: todas"
            opcoes={[
              { value: "vigente", label: "Em garantia" }, { value: "vencendo", label: "Vencendo (≤30d)" },
              { value: "vencida", label: "Vencida" }, { value: "sem", label: "Sem garantia" },
            ]}
          />
          <button onClick={() => setMaisAberto((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 px-2 py-1.5">
            <SlidersHorizontal className="w-4 h-4" /> Mais
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", maisAberto && "rotate-180")} />
          </button>
          {maisAberto && (
            <>
              <SelectFiltro
                valor={f.qr} onChange={(v) => navegar({ qr: v || null })}
                vazio="QR: todos" opcoes={[{ value: "com", label: "Com QR" }, { value: "sem", label: "Sem QR" }]}
              />
              <SelectFiltro
                valor={f.fluido} onChange={(v) => navegar({ fluido: v || null })}
                vazio="Fluido: todos" opcoes={opcoes.fluidos.map((x) => ({ value: x, label: x }))}
              />
            </>
          )}
          {filtrosAtivos > 0 && (
            <button onClick={limpar} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-atrasado">
              <X className="w-3.5 h-3.5" /> Limpar filtros ({filtrosAtivos})
            </button>
          )}
        </div>

        {/* Trilha do local filtrado */}
        {clienteSel && (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted flex-wrap pt-2 border-t border-surface-border/70">
            <span className="text-ink-subtle">Local:</span>
            <button onClick={() => navegar({ unidade: null, setor: null })} className="font-medium text-ink hover:text-primary-600">{clienteSel.label}</button>
            {unidadeSel && (<><ChevronRight className="w-3 h-3" /><button onClick={() => navegar({ setor: null })} className="font-medium text-ink hover:text-primary-600">{unidadeSel.label}</button></>)}
            {f.setor && (<><ChevronRight className="w-3 h-3" /><span className="font-medium text-ink">{f.setor}</span></>)}
          </div>
        )}
      </div>

      {/* ── Resultados ── */}
      <div className={cn("transition-opacity", pendente && "opacity-60")}>
        {itens.length === 0 ? (
          <div className="bg-white border border-surface-border rounded-card text-center py-16">
            <Thermometer className="w-10 h-10 text-ink-subtle mx-auto mb-3" />
            <p className="text-ink font-medium">Nenhum equipamento encontrado</p>
            <p className="text-sm text-ink-muted mt-1">
              {filtrosAtivos > 0 ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro equipamento."}
            </p>
            {filtrosAtivos > 0 && <button onClick={limpar} className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-700">Limpar filtros</button>}
          </div>
        ) : (
          <>
            {/* Celular: lista compacta (sempre) */}
            <div className="md:hidden bg-white border border-surface-border rounded-card divide-y divide-surface-border overflow-hidden">
              {itens.map((e) => (
                <div key={e.id} className="flex items-stretch">
                  {massa && <div className="pl-3 pt-4"><CheckboxLinha id={e.id} rotulo={descricaoEquipamento(e)} /></div>}
                  <div className="min-w-0 flex-1"><LinhaMobile e={e} /></div>
                </div>
              ))}
            </div>
            {/* Desktop: tabela densa (padrão) ou cards */}
            <div className="hidden md:block">
              {visao === "lista"
                ? <Tabela itens={itens} f={f} onOrdenar={ordenar} onFiltrar={navegar} podeEditar={podeEditar} massa={massa} />
                : <Cards itens={itens} massa={massa} />}
            </div>
          </>
        )}
      </div>

      {/* ── Paginação ── */}
      <Paginacao total={total} pagina={f.pagina} porPagina={f.porPagina} onNavegar={navegar} />
    </div>
  );
}

/* ───────── Tabela (desktop), no padrão de lista ───────── */
// As larguras somam o que cabe num notebook (1440px com o menu aberto) sem rolar de lado: o status não
// tem coluna (o inativo leva o selo ao lado do nome) e cliente e unidade dividem uma.
const COLUNAS: ColunaPro[] = [
  { id: "equipamento", titulo: "Equipamento", ordenar: "tipo", obrigatoria: true, minimo: 200 },
  { id: "identificacao", titulo: "Identificação", largura: 170, classe: "truncate" },
  { id: "ambiente", titulo: "Ambiente", largura: 140, classe: "truncate" },
  { id: "local", titulo: "Cliente e unidade", largura: 198, ordenar: "cliente" },
  { id: "garantia", titulo: "Garantia", largura: 96, ordenar: "garantia" },
  { id: "ultimo", titulo: "Últ. atend.", largura: 96, ordenar: "ultimo" },
  // 4 ícones de 28px + respiro: abaixo disso a célula estoura e a tabela ganha rolagem lateral
  { id: "acoes", titulo: "Ações", fixa: true, semTitulo: true, largura: 136, alinhar: "direita", classe: "py-0.5" },
];

function Tabela({
  itens, f, onOrdenar, onFiltrar, podeEditar, massa,
}: {
  itens: EquipLinha[]; f: FiltrosListagem; onOrdenar: (k: OrdemListagem) => void;
  onFiltrar: (m: Record<string, string | null>) => void; podeEditar: boolean; massa: boolean;
}) {
  const filtro = "block max-w-full truncate text-left hover:text-primary-600";
  return (
    <TabelaPro
      tela="equipamentos" className="bg-white border border-surface-border rounded-card overflow-hidden" atributos={{ "data-tabela-equipamentos": true }}
      ordenacao={{ ativa: f.ordem, dir: f.dir, onOrdenar: (k) => onOrdenar(k as OrdemListagem) }}
      barra={<span>{itens.length === 1 ? "1 equipamento nesta página" : `${itens.length} equipamentos nesta página`}</span>}
      colunas={[
        ...(massa ? [{ id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxPagina />, classe: "pl-3" }] : []),
        ...COLUNAS,
      ]}
      linhas={itens.map((e) => {
        const detalhe = [e.temNome ? e.nome : null, fabricanteModelo(e), identificadores(e) || null].filter(Boolean).join(" · ");
        const a = ambienteEquipamento(e);
        const ambiente = a.principal ? [a.principal, a.complemento].filter(Boolean).join(" · ") : null;
        return {
          id: e.id, atributos: { "data-equipamento": e.id }, classe: e.ativo ? undefined : "opacity-60",
          titulos: { equipamento: descricaoEquipamento(e), identificacao: detalhe || undefined, ambiente: ambiente ?? undefined },
          celulas: {
            sel: massa ? <CheckboxLinha id={e.id} rotulo={descricaoEquipamento(e)} /> : null,
            equipamento: (
              <span className="flex items-center gap-2 min-w-0">
                <Link href={`/equipamentos/${e.id}`} className="flex items-center gap-2 min-w-0 hover:text-primary-600">
                  <Miniatura e={e} pequena />
                  <span data-descricao className={cn(PLANILHA.nome, "truncate")}>{descricaoEquipamento(e)}</span>
                </Link>
                {!e.ativo && <StatusSelo ativo={false} className="shrink-0" />}
              </span>
            ),
            identificacao: detalhe ? <span className={PLANILHA.apagado}>{detalhe}</span> : <span className="text-ink-subtle">—</span>,
            ambiente: ambiente
              ? <button type="button" data-ambiente onClick={() => onFiltrar({ cliente: e.clienteId, unidade: e.unidadeId, setor: e.setor ?? null })} className={cn(filtro, "text-ink")} title={`Filtrar por ${ambiente}`}>{ambiente}</button>
              : <span className="text-ink-subtle">Não informado</span>,
            local: (
              <span className="flex items-center gap-1 min-w-0">
                <button type="button" onClick={() => onFiltrar({ cliente: e.clienteId, unidade: null, setor: null })} className={cn(filtro, "text-ink shrink min-w-0")} title={`Filtrar por ${e.cliente}`}>{e.cliente}</button>
                <span className="text-ink-subtle shrink-0" aria-hidden>·</span>
                <button type="button" onClick={() => onFiltrar({ cliente: e.clienteId, unidade: e.unidadeId, setor: null })} className={cn(filtro, PLANILHA.apagado, "shrink min-w-0")} title={`Filtrar por ${e.unidade}`}>{e.unidade}</button>
              </span>
            ),
            garantia: <GarantiaSelo fim={e.garantiaAte} compacto />,
            ultimo: e.ultimoAtendimento
              ? <span className={PLANILHA.data} title={haQuanto(e.ultimoAtendimento) ?? undefined}>{formatarData(e.ultimoAtendimento)}</span>
              : <span className="text-ink-subtle">—</span>,
            acoes: <AcoesLinha e={e} podeEditar={podeEditar} />,
          },
        };
      })}
    />
  );
}

function AcoesLinha({ e, podeEditar }: { e: EquipLinha; podeEditar: boolean }) {
  const btn = "p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50";
  const alvo = descricaoEquipamento(e);
  return (
    <span className="inline-flex items-center justify-end gap-0.5" data-acoes-equipamento={e.id}>
      <Link href={`/equipamentos/${e.id}`} title="Ver ficha" aria-label={`Ver a ficha de ${alvo}`} className={btn}><Eye className="w-4 h-4" aria-hidden /></Link>
      {podeEditar && (
        <>
          <Link
            href={`/equipamentos/${e.id}/editar?aba=qrcode`} data-qr-equipamento
            title={e.qrcodeId ? "QR Code vinculado" : "Gerar ou vincular QR Code"} aria-label={`QR Code de ${alvo}`}
            className={cn(btn, e.qrcodeId && "text-ok-texto")}
          >
            <QrCode className="w-4 h-4" aria-hidden />
          </Link>
          <Link href={`/equipamentos/${e.id}/editar`} title="Editar" aria-label={`Editar ${alvo}`} className={btn} data-editar-equipamento><Pencil className="w-4 h-4" aria-hidden /></Link>
        </>
      )}
      <EquipamentoAtivoBotao id={e.id} nome={alvo} ativo={e.ativo} />
    </span>
  );
}

/* ───────── Celular ───────── */
function LinhaMobile({ e }: { e: EquipLinha }) {
  return (
    <Link href={`/equipamentos/${e.id}`} className={cn("flex items-start gap-3 p-3 active:bg-surface-alt", !e.ativo && "opacity-60")}>
      <Miniatura e={e} />
      <div className="min-w-0 flex-1">
        <p data-ambiente className="text-[11px] font-semibold uppercase tracking-wide text-primary-700 truncate flex items-center gap-1">
          <MapPin className="w-3 h-3 shrink-0" />{ambienteTexto(e) ?? "Ambiente não informado"}
        </p>
        <div className="flex items-start justify-between gap-2 mt-0.5">
          <p data-descricao className="font-semibold text-ink leading-tight truncate">{descricaoEquipamento(e)}</p>
          <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" />
        </div>
        <p className="text-xs text-ink-muted truncate mt-0.5">{[e.temNome ? e.nome : null, fabricanteModelo(e), e.patrimonio ? (/^tag\b/i.test(e.patrimonio) ? e.patrimonio : `TAG ${e.patrimonio}`) : null].filter(Boolean).join(" · ")}</p>
        <p className="text-xs text-ink-subtle truncate">{e.cliente} › {e.unidade}</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {e.garantiaAte && <GarantiaSelo fim={e.garantiaAte} compacto />}
          {!e.ativo && <StatusSelo ativo={false} />}
          {e.ultimoAtendimento && (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted"><CalendarCheck className="w-3 h-3" />{formatarData(e.ultimoAtendimento)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ───────── Cards (desktop, alternativo) ───────── */
function Cards({ itens, massa }: { itens: EquipLinha[]; massa: boolean }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
      {itens.map((e) => (
        <div key={e.id} className="relative">
        {massa && <CheckboxLinha id={e.id} rotulo={descricaoEquipamento(e)} className="absolute top-2 left-2 z-10 bg-white rounded p-1.5 m-0 shadow-sm" />}
        <Link href={`/equipamentos/${e.id}`} className={cn("block h-full group bg-white border border-surface-border rounded-card overflow-hidden hover:shadow-md hover:border-primary-300 transition-all", !e.ativo && "opacity-60")}>
          <div className="aspect-[16/9] bg-surface-alt overflow-hidden">
            {e.foto
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={e.foto} alt={e.nome} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              : <TipoIcone tipo={e.tipo} tamanho="xl" className="rounded-none" />}
          </div>
          <div className="p-3.5 space-y-2">
            <div>
              <p data-ambiente className="text-[11px] font-semibold uppercase tracking-wide text-primary-700 truncate flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" />{ambienteTexto(e) ?? "Ambiente não informado"}
              </p>
              <h3 data-descricao className="font-semibold text-ink leading-tight truncate group-hover:text-primary-600 mt-0.5">{descricaoEquipamento(e)}</h3>
              <p className="text-xs text-ink-muted truncate">{[e.temNome ? e.nome : null, fabricanteModelo(e)].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <GarantiaSelo fim={e.garantiaAte} compacto />
              <StatusSelo ativo={e.ativo} />
            </div>
            <p className="text-xs text-ink-muted truncate flex items-center gap-1.5 pt-2 border-t border-surface-border/70">
              <Building2 className="w-3.5 h-3.5 shrink-0" /> {e.cliente} › {e.unidade}
            </p>
          </div>
        </Link>
        </div>
      ))}
    </div>
  );
}

/* ───────── Peças ───────── */
function Miniatura({ e, pequena }: { e: EquipLinha; pequena?: boolean }) {
  if (!e.foto) return <TipoIcone tipo={e.tipo} tamanho={pequena ? "sm" : "md"} className={pequena ? "w-7 h-7 shrink-0" : undefined} />;
  const lado = pequena ? 28 : 48;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={e.foto} alt="" loading="lazy" decoding="async" width={lado} height={lado} className={cn("object-cover border border-surface-border shrink-0 bg-surface-alt", pequena ? "w-7 h-7 rounded-md" : "w-12 h-12 rounded-lg")} />
  );
}
