"use client";

import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CampoBusca, ListaVazia, Paginacao, sugerirPorUrl } from "@/components/listagem/listagem-ui";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";
import { Dica } from "@/components/ui/dica";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { DEBOUNCE_BUSCA_MS, useTamanhoPreferido } from "@/components/listagem/use-listagem-url";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { passoCobranca, textoFrequencia } from "@/lib/financeiro/contrato-previsao";
import { cn, formatarData, formatarMoeda, LABELS_PERIODICIDADE } from "@/lib/utils";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import {
  FileText, Plus, Search, SlidersHorizontal, X,
  Filter, BarChart3, Wallet, CalendarClock, AlertTriangle,
} from "lucide-react";
import { InputData } from "@/components/ui/input-data";
import { FiltroCanceladosUrl } from "@/components/listagem/barra-filtros";

interface ContratoView {
  id: string; numero: string; cliente: string; clienteLogo: string | null; periodicidade: string; valorMensal: number | null;
  dataInicio: string; dataFim: string | null; status: string; vencido: boolean; vencendo: boolean;
  proximaOs: { id: string; numero: string; status: string; previsaoConclusao: string | null } | null;
}
interface Resumo { ativos: number; valorMensalTotal: number; valorAnualTotal: number; vencendo: number; vencidos: number }

const LABELS_STATUS: Record<string, string> = {
  ATIVO: "Ativo", SUSPENSO: "Suspenso", EM_RENOVACAO: "Em renovação", ENCERRADO: "Encerrado", CANCELADO: "Cancelado", VENCIDO: "Vencido", AGUARDANDO_ASSINATURA: "Aguardando assinatura",
};
const COR_STATUS: Record<string, string> = {
  ATIVO: "bg-ok-claro text-ok-texto", SUSPENSO: "bg-atencao-claro text-atencao-texto", EM_RENOVACAO: "bg-acento-claro text-acento-hover",
  ENCERRADO: "bg-surface-linha text-ink-muted", CANCELADO: "bg-previsto-claro text-previsto-texto", VENCIDO: "bg-atrasado-claro text-atrasado-texto", AGUARDANDO_ASSINATURA: "bg-acento-claro text-acento-hover",
};
const COR_FREQ: Record<string, string> = {
  SEMANAL: "bg-previsto-claro text-previsto-texto", QUINZENAL: "bg-previsto-claro text-previsto-texto",
  MENSAL: "bg-previsto-claro text-previsto-texto", BIMESTRAL: "bg-previsto-claro text-previsto-texto",
  TRIMESTRAL: "bg-previsto-claro text-previsto-texto", SEMESTRAL: "bg-previsto-claro text-previsto-texto", ANUAL: "bg-previsto-claro text-previsto-texto",
};

const FILTROS = ["busca", "status", "frequencia", "vigenciaInicio", "vigenciaFim", "valorMin", "valorMax", "clienteId", "cancelados"];

/** Princípio 7: o que a tela mostra fica no ⓘ do título, não num parágrafo acima da lista. */
const AJUDA = "Contratos de manutenção: o valor é o de CADA cobrança, e o valor por ano segue a frequência. Vencidos e vencendo em 30 dias aparecem destacados. O reajuste anual é decidido em Contratos › Reajustes a aplicar.";

export function ContratosListaClient({ contratos, total, pagina, porPagina, somaMensalFiltrada, resumo, opcoesClientes }: {
  contratos: ContratoView[]; total: number; pagina: number; porPagina: number; somaMensalFiltrada: number; resumo: Resumo; opcoesClientes: OpcaoBusca[];
}) {
  const massa = useAcoesMassaDisponiveis("contratos");
  const { pode } = usePermissoes();
  // Prioridade 1: o formulário recusa quem não pode criar — o botão não oferece o caminho
  const podeCriar = pode("contratos", "criar");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const sortAtual = get("sort") || "dataInicio";
  const dirAtual = (get("dir") || "desc") as "asc" | "desc";
  const filtrosAtivos = FILTROS.filter((k) => get(k) !== "").length;

  const [avancado, setAvancado] = useState(["vigenciaInicio", "vigenciaFim", "valorMin", "valorMax", "clienteId"].some((k) => get(k) !== ""));
  const [buscaLocal, setBuscaLocal] = useState(get("busca"));
  const [valorMin, setValorMin] = useState(get("valorMin"));
  const [valorMax, setValorMax] = useState(get("valorMax"));

  const [pendente, startTransition] = useTransition();
  /** Muda a URL; qualquer filtro novo volta para a página 1 (só a paginação mantém a página). */
  function setParams(updates: Record<string, string | null>, manterPagina = false) {
    const novo = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) { if (v) novo.set(k, v); else novo.delete(k); }
    if (!manterPagina && !("pagina" in updates)) novo.delete("pagina");
    startTransition(() => router.replace(`${pathname}?${novo.toString()}`, { scroll: false }));
  }
  useTamanhoPreferido((por) => setParams({ por }, true));
  const sugerir = useMemo(() => sugerirPorUrl("/api/listas/sugestoes?lista=contratos"), []);


  useEffect(() => { const t = setTimeout(() => { if (buscaLocal !== get("busca")) setParams({ busca: buscaLocal || null }); }, DEBOUNCE_BUSCA_MS); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [buscaLocal]);
  useEffect(() => { const t = setTimeout(() => { if (valorMin !== get("valorMin")) setParams({ valorMin: valorMin || null }); }, 600); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [valorMin]);
  useEffect(() => { const t = setTimeout(() => { if (valorMax !== get("valorMax")) setParams({ valorMax: valorMax || null }); }, 600); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [valorMax]);

  function ordenarPor(campo: string) {
    if (sortAtual === campo) setParams({ dir: dirAtual === "asc" ? "desc" : "asc" });
    else setParams({ sort: campo, dir: "asc" });
  }
  function limpar() { setBuscaLocal(""); setValorMin(""); setValorMax(""); router.replace(get("por") ? `${pathname}?por=${get("por")}` : pathname, { scroll: false }); }

  const selectCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  // Base neutra; a cor só nos dois cartões de alerta, e só quando há o que alertar (cor com função)
  const neutro = { cor: "text-ink", icone: "text-ink-muted", bg: "bg-surface-alt" };
  const cards = [
    { label: "Contratos ativos", valor: String(resumo.ativos), Icone: FileText, ...neutro },
    { label: "Valor mensal total", valor: formatarMoeda(resumo.valorMensalTotal), Icone: Wallet, ...neutro },
    { label: "Valor anual total", valor: formatarMoeda(resumo.valorAnualTotal), Icone: BarChart3, ...neutro },
    { label: "Vencendo em 30 dias", valor: String(resumo.vencendo), Icone: CalendarClock, ...(resumo.vencendo > 0 ? { cor: "text-atencao-texto", icone: "text-atencao-texto", bg: "bg-atencao-claro" } : neutro) },
    { label: "Vencidos", valor: String(resumo.vencidos), Icone: AlertTriangle, ...(resumo.vencidos > 0 ? { cor: "text-atrasado-texto", icone: "text-atrasado-texto", bg: "bg-atrasado-claro" } : neutro) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><FileText className="w-5 h-5 text-ink-muted" aria-hidden /></div>
          <h1 className="page-title flex items-center gap-1.5">Contratos <Dica texto={AJUDA} rotulo="Contratos" lado="direita" /></h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contratos/relatorio" className="inline-flex items-center gap-2 bg-white border border-surface-border text-ink hover:bg-surface-alt px-4 py-2.5 rounded-lg text-sm font-semibold transition-all">
            <BarChart3 className="w-4 h-4" /> Relatório
          </Link>
          {podeCriar && (
            <Link href="/contratos/novo" data-novo-contrato className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
              <Plus className="w-4 h-4" aria-hidden /> Novo contrato
            </Link>
          )}
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-4" data-card-resumo={c.label}>
            <div className={cn("p-2 rounded-lg w-fit mb-2", c.bg)}><c.Icone className={cn("w-4 h-4", c.icone)} /></div>
            <p className={cn("text-lg font-semibold tabular-nums", c.cor)}>{c.valor}</p>
            <p className="text-xs text-ink-muted mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        {/* Filtros */}
        <div className="p-4 border-b border-surface-border bg-surface-alt/40 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex-1 min-w-[220px]">
              <CampoBusca
                valor={buscaLocal} onChange={setBuscaLocal} placeholder="Pesquisar por número ou cliente…" rotulo="Pesquisar contratos"
                sugerir={sugerir} onEscolher={(s) => s.href && router.push(s.href)} carregando={pendente}
              />
            </div>
            <select value={get("status")} onChange={(e) => setParams({ status: e.target.value || null })} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
              <option value="">Todos status</option>
              <option value="ATIVO">Ativo</option>
              <option value="SUSPENSO">Suspenso</option>
              <option value="EM_RENOVACAO">Em renovação</option>
              <option value="ENCERRADO">Encerrado</option>
              <option value="CANCELADO">Cancelado</option>
              <option value="VENCENDO">Vencendo (30d)</option>
              <option value="VENCIDO">Vencido</option>
            </select>
            <select value={get("frequencia")} onChange={(e) => setParams({ frequencia: e.target.value || null })} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
              <option value="">Toda frequência</option>
              {Object.entries(LABELS_PERIODICIDADE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" onClick={() => setAvancado((v) => !v)}
              className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors", avancado ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:bg-surface-alt")}>
              <SlidersHorizontal className="w-4 h-4" /> Mais filtros
            </button>
            {/* Cancelado fica fora da lista padrão (como em OS e orçamentos); o status "Cancelado" também traz */}
            <FiltroCanceladosUrl navegar={(p) => setParams(p)} />
          </div>

          {avancado && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-surface-border">
              <div><label className="text-[11px] font-semibold text-ink-muted">Vigência — início de</label><InputData defaultValue={get("vigenciaInicio")} onChange={(v) => setParams({ vigenciaInicio: v || null })} /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Vigência — início até</label><InputData defaultValue={get("vigenciaFim")} onChange={(v) => setParams({ vigenciaFim: v || null })} /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Valor mensal — de</label><input type="number" min="0" step="0.01" value={valorMin} onChange={(e) => setValorMin(e.target.value)} placeholder="R$ mín." className={selectCls} /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Valor mensal — até</label><input type="number" min="0" step="0.01" value={valorMax} onChange={(e) => setValorMax(e.target.value)} placeholder="R$ máx." className={selectCls} /></div>
              <div className="lg:col-span-2"><label className="text-[11px] font-semibold text-ink-muted">Cliente</label><BuscaSelect value={get("clienteId")} onChange={(v) => setParams({ clienteId: v || null })} options={opcoesClientes} placeholder="Todos" /></div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <span className="text-sm text-ink-muted" data-contador><strong className="text-ink">{total.toLocaleString("pt-BR")}</strong> {total === 1 ? "contrato" : "contratos"}{filtrosAtivos > 0 && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full"><Filter className="w-3 h-3" aria-hidden /> {filtrosAtivos === 1 ? "1 filtro" : `${filtrosAtivos} filtros`}</span>}</span>
            {filtrosAtivos > 0 && <button type="button" onClick={limpar} className="inline-flex items-center gap-1 text-xs font-medium text-atrasado hover:text-atrasado-texto"><X className="w-3.5 h-3.5" /> Limpar filtros</button>}
          </div>
        </div>

        <div className={cn("transition-opacity", pendente && "opacity-60")} aria-busy={pendente}>
        {contratos.length === 0 ? (
          <div className="pb-2">
            <ListaVazia mensagem="Nenhum contrato encontrado" busca={buscaLocal || undefined} onLimpar={limpar} />
            {filtrosAtivos > 0 && !buscaLocal && (
              <p className="text-center -mt-1"><button type="button" onClick={limpar} className="text-sm text-primary-600 hover:underline">Limpar filtros</button></p>
            )}
          </div>
        ) : (<>
        {/* Celular: um cartão por contrato */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
          {contratos.map((ct) => (
            <li key={ct.id} data-cartao={ct.id} className={cn("flex items-start gap-3 px-4 py-3", ct.vencido && "bg-atrasado-claro/60", (ct.status === "ENCERRADO" || ct.status === "CANCELADO") && "opacity-60")}>
              {massa && <span className="pt-0.5"><CheckboxLinha id={ct.id} rotulo={ct.numero} /></span>}
              <Link href={`/contratos/${ct.id}`} className="min-w-0 flex-1">
                <p className="text-sm"><span className="font-mono font-semibold text-primary-600">{ct.numero}</span> <span className="text-ink font-medium">{ct.cliente}</span></p>
                <p className="text-xs text-ink-muted">{LABELS_PERIODICIDADE[ct.periodicidade] ?? ct.periodicidade} · {ct.dataFim ? `até ${formatarData(ct.dataFim)}` : "indeterminado"}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {ct.vencido ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-atrasado-claro text-atrasado-texto">Vencido</span>
                    : ct.vencendo ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-atencao-claro text-atencao-texto">Vence em breve</span>
                    : <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", COR_STATUS[ct.status])}>{LABELS_STATUS[ct.status] ?? ct.status}</span>}
                  <span className="ml-auto text-sm font-semibold text-ink">{formatarMoeda(ct.valorMensal)}<span className="text-xs font-normal text-ink-muted">{passoCobranca(ct.periodicidade) > 1 ? ` · ${textoFrequencia(passoCobranca(ct.periodicidade))}` : "/mês"}</span></span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <TabelaPro
          tela="contratos" atributos={{ "data-tabela-contratos": true }}
          ordenacao={{ ativa: sortAtual, dir: dirAtual, onOrdenar: ordenarPor }}
          barra={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>{total === 1 ? "1 contrato filtrado" : `${total} contratos filtrados`}</span>
              <span className="tabular-nums" title="Equivalente por mês">{formatarMoeda(somaMensalFiltrada)}<span className="text-ink-muted">/mês</span></span>
              <span className="tabular-nums" title="Equivalente por ano">{formatarMoeda(somaMensalFiltrada * 12)}<span className="text-ink-muted">/ano</span></span>
            </span>
          }
          colunas={[
            ...(massa ? [{ id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxPagina />, classe: "pl-3" }] : []),
            { id: "numero", titulo: "Número", ordenar: "numero", obrigatoria: true, largura: 120 },
            { id: "cliente", titulo: "Cliente", ordenar: "cliente", minimo: 200, classe: "truncate" },
            { id: "frequencia", titulo: "Frequência", largura: 128 },
            { id: "valor", titulo: "Valor da cobrança", ordenar: "valorMensal", largura: 148, alinhar: "direita" },
            { id: "ano", titulo: "Valor/ano", largura: 124, alinhar: "direita" },
            { id: "inicio", titulo: "Início", ordenar: "dataInicio", largura: 104 },
            { id: "fim", titulo: "Fim", ordenar: "dataFim", largura: 124 },
            { id: "status", titulo: "Status", ordenar: "status", largura: 148 },
            { id: "proximaOs", titulo: "Próxima OS", largura: 160, classe: "truncate" },
          ]}
          linhas={contratos.map((ct) => ({
            id: ct.id, atributos: { "data-contrato": ct.id }, href: `/contratos/${ct.id}`,
            classe: cn(ct.vencido && "bg-atrasado-claro/60 hover:bg-atrasado-claro", (ct.status === "ENCERRADO" || ct.status === "CANCELADO") && "opacity-60"),
            titulos: { cliente: ct.cliente, fim: ct.dataFim ? undefined : "Sem data de fim: vigência indeterminada" },
            celulas: {
              sel: massa ? <CheckboxLinha id={ct.id} rotulo={ct.numero} /> : null,
              numero: <Link href={`/contratos/${ct.id}`} className={cn(PLANILHA.codigo, "text-primary-600 hover:underline")}>{ct.numero}</Link>,
              cliente: (
                <span className="flex items-center gap-2 min-w-0">
                  <AvatarCliente nome={ct.cliente} logoUrl={ct.clienteLogo} size={24} />
                  <span className={cn(PLANILHA.nome, "truncate")}>{ct.cliente}</span>
                </span>
              ),
              frequencia: <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap", COR_FREQ[ct.periodicidade])}>{LABELS_PERIODICIDADE[ct.periodicidade] ?? ct.periodicidade}</span>,
              valor: (
                <span className={PLANILHA.numero}>
                  {formatarMoeda(ct.valorMensal)}
                  {passoCobranca(ct.periodicidade) > 1 && <span className="block text-[11px] font-normal text-ink-muted">{textoFrequencia(passoCobranca(ct.periodicidade))}</span>}
                </span>
              ),
              ano: <span className={cn(PLANILHA.numero, PLANILHA.apagado)}>{ct.valorMensal != null ? formatarMoeda(ct.valorMensal * 12 / passoCobranca(ct.periodicidade)) : "—"}</span>,
              inicio: <span className={cn(PLANILHA.apagado, PLANILHA.data)}>{formatarData(ct.dataInicio)}</span>,
              fim: <span className={cn(PLANILHA.data, ct.vencido ? "text-atrasado font-medium" : PLANILHA.apagado)}>{ct.dataFim ? formatarData(ct.dataFim) : "indeterminado"}</span>,
              status: ct.vencido
                ? <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-atrasado-claro text-atrasado-texto whitespace-nowrap">Vencido</span>
                : ct.vencendo
                ? <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-atencao-claro text-atencao-texto whitespace-nowrap">Vence em breve</span>
                : <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap", COR_STATUS[ct.status])}>{LABELS_STATUS[ct.status] ?? ct.status}</span>,
              proximaOs: ct.proximaOs
                ? <Link href={`/ordens/${ct.proximaOs.id}`} className="text-xs text-primary-600 hover:underline">{ct.proximaOs.numero}{ct.proximaOs.previsaoConclusao ? ` · ${formatarData(ct.proximaOs.previsaoConclusao)}` : ""}</Link>
                : <span className="text-xs text-ink-subtle">—</span>,
            },
          }))}
        />
        </>)}
        </div>
        <div className="px-4 py-3 border-t border-surface-border">
          <Paginacao total={total} pagina={pagina} porPagina={porPagina} rotulo="contratos" onNavegar={setParams} />
        </div>
      </div>
    </div>
  );
}
