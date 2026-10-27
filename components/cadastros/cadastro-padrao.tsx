"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Check, Pencil, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import { CheckboxLinha, CheckboxPagina, SelecaoMassaProvider } from "@/components/acoes-massa/selecao";
import { podeAcao, podeExportar, type AcaoItem, type Entidade } from "@/lib/acoes-massa/acoes";
import { cn, formatarMoeda } from "@/lib/utils";
import { lerTamanho, proximaOrdem, TAMANHO_PADRAO, type Ordem } from "@/lib/listagem";
import { CampoBusca, ListaVazia, lerTamanhoPreferido, Paginacao, SkeletonLista, sugerirPorUrl, ThOrd } from "@/components/listagem/listagem-ui";
import { DEBOUNCE_BUSCA_MS } from "@/components/listagem/use-listagem-url";
import { ImportarPlanilha } from "@/components/importacao/importar-planilha";
import { BaixarPlanilha } from "@/components/importacao/baixar-planilha";
import { ehEntidadeImportacao } from "@/lib/importacao/entidades";
import { CADASTROS, type AcaoCadastro, type CampoCadastro, type ColunaCadastro, type DefCadastro, type EntidadeCadastro } from "@/lib/cadastros/registro";

/**
 * Tela padrão de um cadastro (lib/cadastros/registro.ts): abas Ativos / Inativos / Todos com busca
 * que vale nas três; criar/editar num painel lateral (edição manda só o que mudou); inativar com
 * o impacto ("em uso: 12 orçamentos e 3 medições"); reativar; seleção em massa (PR #31).
 * Botões aparecem conforme a permissão; toda gravação que falha mostra o motivo (nada silencioso).
 * Lista paginada NO SERVIDOR (25/50/100 por página, lembrado), busca ao vivo com sugestões,
 * ordenação pelo cabeçalho e cartões no celular. Tudo na URL (?aba=&q=&pagina=&por=&ordem=&dir=):
 * o "selecionar todos do filtro" usa o mesmo filtro no servidor (paginação/ordem não contam).
 */
export type ItemCadastroTela = Record<string, any> & { id: string; nome: string; ativo: boolean };
type Item = ItemCadastroTela;

/** Editor próprio (perfis, modelos de encargos, usuários): abre/fecha e grava pela rota genérica. */
export interface EditorCadastroProps { item: Item | null; aberto: boolean; onFechar: () => void; onSalvo: (item: Item) => void }

export interface CadastroPadraoProps {
  entidade: EntidadeCadastro;
  /** Formulário próprio (registro com `editorProprio`) */
  Editor?: ComponentType<EditorCadastroProps>;
  /** Célula personalizada (undefined = padrão do registro) */
  celula?: (coluna: string, item: Item) => ReactNode | undefined;
  /** Botões extras na linha (ex.: reenviar convite) */
  acoesLinha?: (item: Item, recarregar: () => void) => ReactNode;
  /** Texto acima da lista */
  ajuda?: ReactNode;
}

/** Grava pela rota genérica (POST cria / PATCH edita) — usado pelos editores próprios. */
export async function salvarCadastro(entidade: EntidadeCadastro, id: string | null, corpo: Record<string, unknown>):
  Promise<{ ok: true; item: Item } | { ok: false; erro: string }> {
  try {
    const res = await fetch(id ? `/api/cadastros/${entidade}/${id}` : `/api/cadastros/${entidade}`, {
      method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.id) return { ok: false, erro: d?.erro ?? "Não foi possível salvar." };
    return { ok: true, item: d };
  } catch { return { ok: false, erro: "Erro de conexão: nada foi salvo." }; }
}
type Aba = "ativos" | "inativos" | "todos";
const ABAS: { id: Aba; label: string }[] = [{ id: "ativos", label: "Ativos" }, { id: "inativos", label: "Inativos" }, { id: "todos", label: "Todos" }];

export function CadastroPadrao(props: CadastroPadraoProps) {
  // useSearchParams exige Suspense nas páginas client
  return <Suspense fallback={<p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>}><Conteudo {...props} /></Suspense>;
}

/** O perfil pode esta ação do cadastro? (requisito null = basta estar logado) */
function usePodeCadastro(def: DefCadastro) {
  const { pode } = usePermissoes();
  return (acao: AcaoCadastro) => { const req = def.permissoes[acao]; return !req || req.some(([m, a]) => pode(m, a)); };
}

const vazioParaForm = (c: CampoCadastro) => (c.tipo === "cor" ? "#64748B" : c.tipo === "select" ? c.opcoes?.[0]?.value ?? "" : "");
const valorParaForm = (c: CampoCadastro, v: unknown) => (v == null ? (c.tipo === "cor" ? "#64748B" : "") : String(v));

/** Seleção em massa: só cadastros registrados nas ações em massa e com alguma ação permitida. */
function useMassa(def: DefCadastro) {
  const { permissoes, role } = usePermissoes();
  if (!def.massa) return false;
  const e = def.entidade as Entidade;
  return podeExportar(permissoes, role, e) || (["inativar", "reativar"] as AcaoItem[]).some((a) => podeAcao(permissoes, role, e, a));
}

function ComSelecao({ ativo, entidade, ids, total, children }: { ativo: boolean; entidade: EntidadeCadastro; ids: string[]; total: number; children: ReactNode }) {
  if (!ativo) return <>{children}</>;
  return <SelecaoMassaProvider entidade={entidade as Entidade} idsPagina={ids} total={total}>{children}</SelecaoMassaProvider>;
}

/** Resposta paginada da rota genérica (?pagina=&por=) */
interface PaginaLista { itens: Item[]; total: number; pagina: number; porPagina: number; contagens: Record<Aba, number> }
const FILTRO_ABA: Record<Aba, string> = { ativos: "sim", inativos: "nao", todos: "todos" };

function Conteudo({ entidade, Editor, celula, acoesLinha, ajuda }: CadastroPadraoProps) {
  const def = CADASTROS[entidade];
  const podeCad = usePodeCadastro(def);
  const massa = useMassa(def);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const aba: Aba = sp.get("aba") === "inativos" ? "inativos" : sp.get("aba") === "todos" ? "todos" : "ativos";
  const qUrl = sp.get("q") ?? "";
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const porPagina = lerTamanho(sp.get("por"));
  const ordem: Ordem = { campo: sp.get("ordem"), dir: sp.get("dir") === "desc" ? "desc" : "asc" };

  const [dados, setDados] = useState<PaginaLista | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState("");
  const [editando, setEditando] = useState<Item | "novo" | null>(null);
  const [busca, setBusca] = useState(qUrl);

  function mudarUrl(m: Record<string, string | null>, manterPagina = false) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(m)) { if (v) p.set(k, v); else p.delete(k); }
    if (!manterPagina && !("pagina" in m)) p.delete("pagina");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }

  // Itens por página: a preferência lembrada vale ao abrir (se a URL não disser outro)
  useEffect(() => {
    const pref = lerTamanhoPreferido();
    if (!sp.get("por") && pref && pref !== TAMANHO_PADRAO) mudarUrl({ por: String(pref) }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca ao vivo: filtra conforme digita (debounce), sem Enter; volta para a página 1
  useEffect(() => {
    if (busca.trim() === qUrl.trim()) return;
    const t = setTimeout(() => mudarUrl({ q: busca.trim() || null }), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);
  useEffect(() => { setBusca((b) => (b.trim() === qUrl.trim() ? b : qUrl)); }, [qUrl]);

  const consulta = new URLSearchParams({ ativo: FILTRO_ABA[aba], pagina: String(pagina), por: String(porPagina) });
  if (qUrl.trim()) consulta.set("q", qUrl.trim());
  if (ordem.campo) { consulta.set("ordem", ordem.campo); consulta.set("dir", ordem.dir); }
  const chaveConsulta = consulta.toString();

  const pedido = useRef(0);
  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setCarregando(true); setErroLista("");
    try {
      const r = await fetch(`/api/cadastros/${entidade}?${chaveConsulta}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (meu !== pedido.current) return; // chegou uma resposta antiga: ignora
      if (!r.ok || !Array.isArray(d?.itens)) { setErroLista(d?.erro ?? `Não foi possível carregar ${def.plural}.`); return; }
      setDados(d);
    } catch { if (meu === pedido.current) setErroLista("Erro de conexão ao carregar a lista."); }
    finally { if (meu === pedido.current) setCarregando(false); }
  }, [entidade, def.plural, chaveConsulta]);
  useEffect(() => { void carregar(); }, [carregar]);

  const sugerir = useMemo(() => sugerirPorUrl(`/api/cadastros/${entidade}?sugestoes=1&ativo=${FILTRO_ABA[aba]}`), [entidade, aba]);
  const itens = dados?.itens ?? [];
  const contagem = dados?.contagens;
  const Titulo = def.singular[0].toUpperCase() + def.singular.slice(1);
  const ordenar = (campo: string) => { const o = proximaOrdem(ordem, campo); mudarUrl({ ordem: o.campo, dir: o.dir === "desc" ? "desc" : null }, true); };
  const vazio = qUrl.trim()
    ? `Nenhum${def.feminino ? "a" : ""} ${def.singular} encontrad${def.feminino ? "a" : "o"}`
    : aba === "inativos" ? `Nenhum${def.feminino ? "a" : ""} ${def.singular} inativ${def.feminino ? "a" : "o"}.` : `Nenhum${def.feminino ? "a" : ""} ${def.singular} cadastrad${def.feminino ? "a" : "o"}.`;
  const acoes = (item: Item) => (
    <div className="flex items-center justify-end gap-1">
      {acoesLinha?.(item, () => void carregar())}
      {podeCad("editar") && (
        <button type="button" onClick={() => setEditando(item)} className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded" title={`Editar ${item.nome}`} aria-label={`Editar ${item.nome}`}>
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {podeCad(item.ativo ? "inativar" : "reativar") && (
        <InativarRegistro
          url={`/api/cadastros/${entidade}/${item.id}`} modulo={def.permissoes.inativar?.[0]?.[0] ?? def.modulo}
          acaoInativar={def.permissoes.inativar?.[0]?.[1] ?? "gerenciar"} acaoReativar={def.permissoes.reativar?.[0]?.[1] ?? "gerenciar"}
          ativo={item.ativo} nome={item.nome} entidade={def.singular} feminino={def.feminino} comMotivo={false}
          aoConcluir={() => void carregar()}
        />
      )}
    </div>
  );
  // Título (em destaque) = 1ª coluna — ou código + nome, quando a 1ª é o código (produto/serviço)
  const nTitulo = def.colunas[0]?.formato === "codigo" ? 2 : 1;
  const valor = (col: ColunaCadastro, item: Item, i: number) => celula?.(col.key, item) ?? <Celula col={col} item={item} primeira={i === nTitulo - 1} />;

  return (
    <ComSelecao ativo={!!def.massa} entidade={entidade} ids={itens.map((i) => i.id)} total={dados?.total ?? 0}>
      <div className="space-y-4" data-cadastro={entidade}>
        {ajuda && <div className="text-sm text-ink-muted">{ajuda}</div>}
        {/* Abas + busca + Novo */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          <div className="flex rounded-lg border border-surface-border p-0.5 bg-surface-alt w-full sm:w-auto" role="tablist">
            {ABAS.map((a) => (
              <button
                key={a.id} type="button" role="tab" aria-selected={aba === a.id} data-aba={a.id}
                onClick={() => mudarUrl({ aba: a.id === "ativos" ? null : a.id })}
                className={cn("flex-1 sm:flex-none px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  aba === a.id ? "bg-white text-primary-700 shadow-sm" : "text-ink-muted hover:text-ink")}
              >
                {a.label} <span className="text-xs text-ink-subtle tabular-nums">({contagem ? contagem[a.id].toLocaleString("pt-BR") : "…"})</span>
              </button>
            ))}
          </div>
          {/* A busca não fica espremida: com pouco espaço, os botões descem para a linha de baixo */}
          <div className="flex-1 sm:min-w-[240px] sm:max-w-sm">
            <CampoBusca
              valor={busca} onChange={setBusca} placeholder={`Buscar ${def.plural}…`} rotulo={`Buscar ${def.plural}`}
              sugerir={sugerir} carregando={carregando && !!dados}
            />
          </div>
          {/* No celular: Baixar | Importar numa linha e "Novo" embaixo, na largura toda (os três não cabem lado a lado) */}
          <div className="flex flex-wrap sm:flex-nowrap gap-2 sm:ml-auto shrink-0 empty:hidden">
            {/* Baixar a planilha (mesmo formato da importação): quem vê o módulo; o servidor confere de novo */}
            {ehEntidadeImportacao(entidade) && <BaixarPlanilha entidade={entidade} className="flex-1 sm:flex-none" />}
            {podeCad("criar") && (
              <>
                {/* Importação em massa: mesma permissão de criar (o servidor confere de novo) */}
                {ehEntidadeImportacao(entidade) && <ImportarPlanilha entidade={entidade} onConcluido={() => void carregar()} className="flex-1 sm:flex-none" />}
                <Button type="button" onClick={() => setEditando("novo")} className="basis-full sm:basis-auto sm:flex-none shrink-0" data-acao="novo-cadastro">
                  <Plus className="w-4 h-4" /> Nov{def.feminino ? "a" : "o"} {def.singular}
                </Button>
              </>
            )}
          </div>
        </div>

        {erroLista ? (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-atrasado-texto" data-erro-lista>
            <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {erroLista}</span>
            <Button type="button" variant="secondary" size="sm" onClick={carregar}><RefreshCw className="w-4 h-4" /> Tentar de novo</Button>
          </div>
        ) : !dados ? (
          <div className="border border-surface-border rounded-lg"><SkeletonLista /></div>
        ) : itens.length === 0 ? (
          <div className="border border-surface-border rounded-lg">
            <ListaVazia mensagem={vazio} busca={qUrl.trim() || undefined} onLimpar={() => setBusca("")} />
          </div>
        ) : (
          <div className={cn("space-y-3 transition-opacity", carregando && "opacity-60")} aria-busy={carregando}>
            {/* Celular: cada registro vira um cartão */}
            <ul className="sm:hidden space-y-2" data-cartoes>
              {itens.map((item) => (
                <li key={item.id} data-cartao={item.id} className={cn("border border-surface-border rounded-lg bg-white p-3", !item.ativo && "text-ink-muted")}>
                  <div className="flex items-start gap-2">
                    {massa && <span className="pt-0.5"><CheckboxLinha id={item.id} rotulo={item.nome} /></span>}
                    <div className="min-w-0 flex-1">
                      {/* Coluna de código (produto/serviço): vai junto do nome no título do cartão */}
                      <div className="text-sm flex items-baseline gap-1.5 min-w-0">
                        {def.colunas.slice(0, nTitulo).map((col, i) => <span key={col.key} className="min-w-0">{valor(col, item, i)}</span>)}
                      </div>
                      {!item.ativo && <span className="mt-1 inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-alt text-ink-muted">Inativo</span>}
                      <dl className="mt-1.5 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                        {def.colunas.slice(nTitulo).map((col, i) => (
                          <div key={col.key} className="contents">
                            <dt className="text-ink-subtle">{col.label}</dt>
                            <dd className="text-ink min-w-0 truncate">{valor(col, item, i + nTitulo)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    <div className="shrink-0">{acoes(item)}</div>
                  </div>
                </li>
              ))}
            </ul>
            {/* Desktop: tabela com cabeçalho ordenável */}
            <div className="hidden sm:block border border-surface-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-alt border-b border-surface-border">
                  <tr>
                    {massa && <th className="w-px pl-4 pr-1 py-3"><CheckboxPagina /></th>}
                    {def.colunas.map((col) => col.ordenar
                      ? <ThOrd key={col.key} label={col.label} k={col.key} ordem={ordem.campo} dir={ordem.dir} onOrdenar={ordenar} className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
                      : <th key={col.key} className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">{col.label}</th>)}
                    {aba === "todos" && <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Situação</th>}
                    <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item, idx) => (
                    <tr key={item.id} data-linha={item.id} className={cn("border-b border-surface-border last:border-0 hover:bg-primary-50/40", idx % 2 === 1 && "bg-surface-alt/30", !item.ativo && "text-ink-muted")}>
                      {massa && <td className="w-px pl-4 pr-1 py-3"><CheckboxLinha id={item.id} rotulo={item.nome} /></td>}
                      {def.colunas.map((col, i) => <td key={col.key} className="px-4 py-3">{valor(col, item, i)}</td>)}
                      {aba === "todos" && (
                        <td className="px-4 py-3">
                          <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", item.ativo ? "bg-ok-claro text-ok-texto" : "bg-surface-alt text-ink-muted")}>
                            {item.ativo ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right whitespace-nowrap">{acoes(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao total={dados.total} pagina={dados.pagina} porPagina={dados.porPagina} rotulo={def.plural} onNavegar={mudarUrl} />
          </div>
        )}
      </div>

      {def.editorProprio && Editor ? (
        // Editor próprio: depois de salvar recarrega (contagens e vínculos vêm do servidor)
        <Editor
          item={editando && editando !== "novo" ? editando : null} aberto={!!editando}
          onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void carregar(); }}
        />
      ) : (
        <FormularioCadastro
          def={def} titulo={Titulo} editando={editando} onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); void carregar(); }}
        />
      )}
      {def.massa && <BarraAcoesMassa aoConcluir={() => void carregar()} />}
    </ComSelecao>
  );
}

function Celula({ col, item, primeira }: { col: ColunaCadastro; item: Item; primeira: boolean }) {
  const v = item[col.key];
  if (col.formato === "moeda") return <>{v != null && v !== "" ? formatarMoeda(Number(v)) : "—"}</>;
  if (col.formato === "codigo") return <span className="font-mono text-xs font-semibold text-ink-muted" data-codigo>{v != null && v !== "" ? String(v) : "—"}</span>;
  if (col.formato === "cor-nome") {
    return (
      <span className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.cor }} />
        <span className="font-medium">{String(v ?? "—")}</span>
      </span>
    );
  }
  return <span className={cn(primeira && "font-medium")}>{v != null && v !== "" ? String(v) : "—"}</span>;
}

/* ───────── Painel de criar/editar ───────── */
function FormularioCadastro({
  def, titulo, editando, onFechar, onSalvo,
}: { def: DefCadastro; titulo: string; editando: Item | "novo" | null; onFechar: () => void; onSalvo: (i: Item) => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const item = editando && editando !== "novo" ? editando : null;

  useEffect(() => {
    if (!editando) return;
    setErro("");
    setForm(Object.fromEntries(def.campos.map((c) => [c.key, item ? valorParaForm(c, item[c.key]) : vazioParaForm(c)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando]);

  async function salvar() {
    for (const c of def.campos) if (c.obrigatorio && !form[c.key]?.trim()) { setErro(`${c.label} é obrigatório.`); return; }
    // Edição manda SÓ o que mudou (o servidor também é parcial: nada que não veio é zerado)
    const corpo = Object.fromEntries(def.campos
      .filter((c) => !item || form[c.key] !== valorParaForm(c, item[c.key]))
      .map((c) => [c.key, form[c.key]]));
    if (item && !Object.keys(corpo).length) { onFechar(); return; }
    setSalvando(true); setErro("");
    try {
      const res = await fetch(item ? `/api/cadastros/${def.entidade}/${item.id}` : `/api/cadastros/${def.entidade}`, {
        method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.id) { setErro(d?.erro ?? "Não foi possível salvar."); return; }
      onSalvo(d);
    } catch { setErro("Erro de conexão: nada foi salvo."); } finally { setSalvando(false); }
  }

  let grupoAnterior: string | undefined;
  return (
    <Drawer
      aberto={!!editando} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : `Nov${def.feminino ? "a" : "o"} ${def.singular}`}
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Adicionar"}</Button>
      </>}
    >
      {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 mb-4">{erro}</div>}
      {item && !item.ativo && (
        <div className="bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-3 py-2 mb-4">
          {titulo} inativ{def.feminino ? "a" : "o"}: não aparece para novas escolhas até ser reativad{def.feminino ? "a" : "o"}.
        </div>
      )}
      <div className="space-y-4">
        {def.campos.map((c) => {
          const cabecalho = c.grupo && c.grupo !== grupoAnterior ? c.grupo : null;
          grupoAnterior = c.grupo;
          return (
            <div key={c.key}>
              {cabecalho && <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted pt-2 pb-1 border-b border-surface-border mb-3">{cabecalho}</h4>}
              <FormField label={c.label} required={c.obrigatorio}>
                <CampoForm campo={c} valor={form[c.key] ?? ""} onChange={(v) => setForm((f) => ({ ...f, [c.key]: v }))} />
              </FormField>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}

function CampoForm({ campo: c, valor, onChange }: { campo: CampoCadastro; valor: string; onChange: (v: string) => void }) {
  if (c.tipo === "textarea") return <Textarea value={valor} onChange={(e) => onChange(e.target.value)} placeholder={c.placeholder} rows={3} />;
  if (c.tipo === "cor") {
    return (
      <div className="flex items-center gap-2">
        <input type="color" value={valor || "#64748B"} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded border border-surface-border cursor-pointer" aria-label={c.label} />
        <Input value={valor} onChange={(e) => onChange(e.target.value)} className="flex-1 font-mono text-xs" />
      </div>
    );
  }
  if (c.tipo === "select") {
    // Valor antigo fora da lista continua aparecendo (não some ao editar)
    const opcoes = c.opcoes ?? [];
    const extra = valor && !opcoes.some((o) => o.value === valor) ? [{ value: valor, label: `${valor} (valor antigo)` }] : [];
    return (
      <select value={valor} onChange={(e) => onChange(e.target.value)} className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
        {[...opcoes, ...extra].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const numerico = c.tipo === "moeda" || c.tipo === "numero" || c.tipo === "inteiro";
  return (
    <Input
      type="text" inputMode={numerico ? (c.tipo === "inteiro" ? "numeric" : "decimal") : undefined}
      value={valor} onChange={(e) => onChange(e.target.value)} placeholder={c.placeholder}
    />
  );
}
