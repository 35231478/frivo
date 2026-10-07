"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Check, Pencil, Plus, RefreshCw, Search } from "lucide-react";
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
import { CADASTROS, type AcaoCadastro, type CampoCadastro, type ColunaCadastro, type DefCadastro, type EntidadeCadastro } from "@/lib/cadastros/registro";

/**
 * Tela padrão de um cadastro (lib/cadastros/registro.ts): abas Ativos / Inativos / Todos com busca
 * que vale nas três; criar/editar num painel lateral (edição manda só o que mudou); inativar com
 * o impacto ("em uso: 12 orçamentos e 3 medições"); reativar; seleção em massa (PR #31).
 * Botões aparecem conforme a permissão; toda gravação que falha mostra o motivo (nada silencioso).
 * Aba e busca ficam na URL (?aba=&q=): o "selecionar todos do filtro" usa o mesmo filtro no servidor.
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

function ComSelecao({ ativo, entidade, ids, children }: { ativo: boolean; entidade: EntidadeCadastro; ids: string[]; children: ReactNode }) {
  if (!ativo) return <>{children}</>;
  return <SelecaoMassaProvider entidade={entidade as Entidade} idsPagina={ids} total={ids.length}>{children}</SelecaoMassaProvider>;
}

function Conteudo({ entidade, Editor, celula, acoesLinha, ajuda }: CadastroPadraoProps) {
  const def = CADASTROS[entidade];
  const podeCad = usePodeCadastro(def);
  const massa = useMassa(def);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const aba: Aba = sp.get("aba") === "inativos" ? "inativos" : sp.get("aba") === "todos" ? "todos" : "ativos";
  const busca = sp.get("q") ?? "";

  const [itens, setItens] = useState<Item[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState("");
  const [editando, setEditando] = useState<Item | "novo" | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErroLista("");
    try {
      const r = await fetch(`/api/cadastros/${entidade}?ativo=todos`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d)) { setErroLista(d?.erro ?? `Não foi possível carregar ${def.plural}.`); return; }
      setItens(d);
    } catch { setErroLista("Erro de conexão ao carregar a lista."); } finally { setCarregando(false); }
  }, [entidade, def.plural]);
  useEffect(() => { void carregar(); }, [carregar]);

  function mudarUrl(m: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(m)) { if (v) p.set(k, v); else p.delete(k); }
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }

  const q = busca.trim().toLowerCase();
  const casaBusca = (i: Item) => !q || def.busca.some((k) => String(i[k] ?? "").toLowerCase().includes(q));
  const contagem = useMemo(() => ({
    ativos: itens.filter((i) => i.ativo && casaBusca(i)).length,
    inativos: itens.filter((i) => !i.ativo && casaBusca(i)).length,
    todos: itens.filter(casaBusca).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [itens, q]);
  const visiveis = itens.filter((i) => casaBusca(i) && (aba === "todos" || (aba === "ativos" ? i.ativo : !i.ativo)));
  const Titulo = def.singular[0].toUpperCase() + def.singular.slice(1);

  return (
    <ComSelecao ativo={!!def.massa} entidade={entidade} ids={visiveis.map((i) => i.id)}>
      <div className="space-y-4" data-cadastro={entidade}>
        {ajuda && <div className="text-sm text-ink-muted">{ajuda}</div>}
        {/* Abas + busca + Novo */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex rounded-lg border border-surface-border p-0.5 bg-surface-alt w-full sm:w-auto" role="tablist">
            {ABAS.map((a) => (
              <button
                key={a.id} type="button" role="tab" aria-selected={aba === a.id} data-aba={a.id}
                onClick={() => mudarUrl({ aba: a.id === "ativos" ? null : a.id })}
                className={cn("flex-1 sm:flex-none px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  aba === a.id ? "bg-white text-primary-700 shadow-sm" : "text-ink-muted hover:text-ink")}
              >
                {a.label} <span className="text-xs text-ink-subtle">({contagem[a.id]})</span>
              </button>
            ))}
          </div>
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={busca} onChange={(e) => mudarUrl({ q: e.target.value || null })} placeholder={`Buscar ${def.plural}…`} className="pl-9" aria-label={`Buscar ${def.plural}`} />
          </div>
          {podeCad("criar") && (
            <Button type="button" onClick={() => setEditando("novo")} className="sm:ml-auto shrink-0">
              <Plus className="w-4 h-4" /> Nov{def.feminino ? "a" : "o"} {def.singular}
            </Button>
          )}
        </div>

        {carregando ? (
          <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>
        ) : erroLista ? (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-red-700" data-erro-lista>
            <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {erroLista}</span>
            <Button type="button" variant="secondary" size="sm" onClick={carregar}><RefreshCw className="w-4 h-4" /> Tentar de novo</Button>
          </div>
        ) : (
          <div className="border border-surface-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt border-b border-surface-border">
                <tr>
                  {massa && <th className="w-px pl-4 pr-1 py-3"><CheckboxPagina /></th>}
                  {def.colunas.map((col, i) => (
                    <th key={col.key} className={cn("text-left px-3 sm:px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider", i > 0 && "hidden sm:table-cell")}>{col.label}</th>
                  ))}
                  {aba === "todos" && <th className="hidden sm:table-cell text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Situação</th>}
                  <th className="text-right px-3 sm:px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && (
                  <tr><td colSpan={def.colunas.length + 3} className="text-center text-ink-subtle py-10">
                    {q ? "Nada encontrado com essa busca." : aba === "inativos" ? `Nenhum${def.feminino ? "a" : ""} ${def.singular} inativ${def.feminino ? "a" : "o"}.` : `Nenhum${def.feminino ? "a" : ""} ${def.singular} cadastrad${def.feminino ? "a" : "o"}.`}
                  </td></tr>
                )}
                {visiveis.map((item, idx) => (
                  <tr key={item.id} data-linha={item.id} className={cn("border-b border-surface-border last:border-0 hover:bg-primary-50/40", idx % 2 === 1 && "bg-surface-alt/30", !item.ativo && "text-ink-muted")}>
                    {massa && <td className="w-px pl-4 pr-1 py-3"><CheckboxLinha id={item.id} rotulo={item.nome} /></td>}
                    {def.colunas.map((col, i) => (
                      <td key={col.key} className={cn("px-3 sm:px-4 py-3", i > 0 && "hidden sm:table-cell")}>
                        {celula?.(col.key, item) ?? <Celula col={col} item={item} primeira={i === 0} />}
                        {/* Celular: a coluna Situação some; o selo vai embaixo do nome */}
                        {i === 0 && !item.ativo && <span className="sm:hidden mt-1 inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-alt text-ink-muted">Inativo</span>}
                      </td>
                    ))}
                    {aba === "todos" && (
                      <td className="hidden sm:table-cell px-4 py-3">
                        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", item.ativo ? "bg-emerald-50 text-emerald-700" : "bg-surface-alt text-ink-muted")}>
                          {item.ativo ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                    )}
                    <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          onSalvo={(salvo) => {
            setItens((p) => (p.some((i) => i.id === salvo.id) ? p.map((i) => (i.id === salvo.id ? salvo : i)) : [...p, salvo].sort((a, b) => a.nome.localeCompare(b.nome))));
            setEditando(null);
          }}
        />
      )}
      {def.massa && <BarraAcoesMassa aoConcluir={() => void carregar()} />}
    </ComSelecao>
  );
}

function Celula({ col, item, primeira }: { col: ColunaCadastro; item: Item; primeira: boolean }) {
  const v = item[col.key];
  if (col.formato === "moeda") return <>{v != null && v !== "" ? formatarMoeda(Number(v)) : "—"}</>;
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
      {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">{erro}</div>}
      {item && !item.ativo && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2 mb-4">
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
        <input type="color" value={valor || "#64748B"} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded border border-gray-300 cursor-pointer" aria-label={c.label} />
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
