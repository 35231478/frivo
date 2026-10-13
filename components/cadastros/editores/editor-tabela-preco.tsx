"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Drawer } from "@/components/ui/drawer";
import { cn, formatarMoeda, LABELS_TIPO_TABELA_PRECO } from "@/lib/utils";
import { calcularValorFinalTabela } from "@/lib/tabela-preco-helpers";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";

interface CatalogoItem { id: string; nome: string; valorPadrao: number; kind: "SERVICO" | "PRODUTO" }
interface ItemEdit {
  _id: string; catalogoId: string; kind: "SERVICO" | "PRODUTO"; nome: string; valorPadrao: number; inativo: boolean;
  tipoPreco: "VALOR_FIXO" | "DESCONTO_PERCENTUAL"; valorFixo: string; descontoPercent: string; bloqueado: boolean;
}

function uid() { return Math.random().toString(36).slice(2); }

/** Itens gravados → edição (o serviço/produto vem junto, mesmo inativo no catálogo). */
function paraEdicao(itens: unknown): ItemEdit[] {
  return (Array.isArray(itens) ? itens : []).map((it: any) => {
    const cat = it.servico ?? it.produto;
    return {
      _id: uid(),
      catalogoId: it.servicoId ?? it.produtoId ?? "",
      kind: it.servicoId ? "SERVICO" : "PRODUTO",
      nome: cat?.nome ?? "(item removido)",
      valorPadrao: cat?.valorPadrao ? Number(cat.valorPadrao) : 0,
      inativo: cat?.ativo === false,
      tipoPreco: it.tipoPreco,
      valorFixo: it.valorFixo != null ? String(Number(it.valorFixo)) : "",
      descontoPercent: it.descontoPercent != null ? String(Number(it.descontoPercent)) : "",
      bloqueado: !!it.bloqueado,
    };
  });
}

/**
 * Editor de tabela de preços (CadastroPadrao › tabelas-preco): nome, tipo, bloqueio e os itens.
 * Grava pela rota genérica; o valor final de cada item é recalculado no servidor.
 */
export function EditorTabelaPreco({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState("PERSONALIZADA");
  const [precosBloqueados, setPrecosBloqueados] = useState(false);
  const [itens, setItens] = useState<ItemEdit[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [carregando, setCarregando] = useState(false);
  // Só grava os itens depois de carregá-los: salvar com a lista vazia apagaria os preços da tabela
  const [itensOk, setItensOk] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setNome(item?.nome ?? ""); setDescricao((item?.descricao as string | null) ?? ""); setTipo(item?.tipo ?? "PERSONALIZADA");
    setPrecosBloqueados(!!item?.precosBloqueados); setItens([]); setItensOk(!item);
    if (!item) return;
    // A lista não traz os itens: busca o registro completo
    let cancelado = false;
    setCarregando(true);
    fetch(`/api/cadastros/tabelas-preco/${item.id}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => null); if (cancelado) return; if (r.ok && d) { setItens(paraEdicao(d.itens)); setItensOk(true); } else setErro(d?.erro ?? "Não foi possível carregar os itens da tabela."); })
      .catch(() => { if (!cancelado) setErro("Erro de conexão ao carregar os itens."); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [aberto, item]);

  useEffect(() => {
    if (!aberto || catalogo.length) return;
    // Catálogo para ADICIONAR itens: só ativos (itens já na tabela trazem os próprios dados, mesmo inativos)
    Promise.all([
      fetch("/api/cadastros/servicos?ativo=sim").then((r) => r.json()).catch(() => []),
      fetch("/api/cadastros/produtos?ativo=sim").then((r) => r.json()).catch(() => []),
    ]).then(([s, p]) => setCatalogo([
      ...(Array.isArray(s) ? s : []).map((x: any) => ({ id: x.id, nome: x.nome, valorPadrao: x.valorPadrao ? Number(x.valorPadrao) : 0, kind: "SERVICO" as const })),
      ...(Array.isArray(p) ? p : []).map((x: any) => ({ id: x.id, nome: x.nome, valorPadrao: x.valorPadrao ? Number(x.valorPadrao) : 0, kind: "PRODUTO" as const })),
    ]));
  }, [aberto, catalogo.length]);

  function adicionarDoCatalogo(c: CatalogoItem) {
    if (itens.some((i) => i.catalogoId === c.id)) return;
    setItens((p) => [...p, {
      _id: uid(), catalogoId: c.id, kind: c.kind, nome: c.nome, valorPadrao: c.valorPadrao, inativo: false,
      tipoPreco: "VALOR_FIXO", valorFixo: String(c.valorPadrao || ""), descontoPercent: "", bloqueado: false,
    }]);
  }
  const patch = (id: string, p: Partial<ItemEdit>) => setItens((arr) => arr.map((i) => (i._id === id ? { ...i, ...p } : i)));

  async function salvar() {
    if (!nome.trim()) { setErro("Informe o nome da tabela."); return; }
    if (!itensOk) { setErro("Os itens da tabela não carregaram: feche e abra de novo antes de salvar."); return; }
    setSalvando(true); setErro("");
    const r = await salvarCadastro("tabelas-preco", item?.id ?? null, {
      nome: nome.trim(), descricao: descricao.trim() || null, tipo, precosBloqueados,
      itens: itens.map((i) => ({
        servicoId: i.kind === "SERVICO" ? i.catalogoId : null,
        produtoId: i.kind === "PRODUTO" ? i.catalogoId : null,
        tipoPreco: i.tipoPreco,
        valorFixo: i.tipoPreco === "VALOR_FIXO" ? i.valorFixo : null,
        descontoPercent: i.tipoPreco === "DESCONTO_PERCENTUAL" ? i.descontoPercent : null,
        bloqueado: i.bloqueado,
      })),
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : "Nova tabela de preços"}
      largura="w-full sm:w-[62vw] sm:min-w-[560px] sm:max-w-[940px]"
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} disabled={carregando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Criar"}</Button>
      </>}
    >
      <div className="space-y-4">
        {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}
        {item && item.ativo === false && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">Tabela inativa: os clientes ligados a ela usam a tabela Padrão até ela ser reativada.</p>}

        <FormGrid cols={2}>
          <FormField label="Nome" required><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Contrato, Belma" maxLength={120} /></FormField>
          <FormField label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(LABELS_TIPO_TABELA_PRECO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormField>
        </FormGrid>
        <FormField label="Descrição"><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} /></FormField>
        <div className="border-t border-surface-border pt-1">
          <ToggleSwitch
            label="Preços bloqueados"
            description="Quando ativo, os valores desta tabela não podem ser alterados no orçamento/medição."
            checked={precosBloqueados}
            onChange={setPrecosBloqueados}
          />
        </div>

        <div>
          <h5 className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Itens da tabela</h5>
          <BuscaCatalogo catalogo={catalogo} jaAdicionados={itens.map((i) => i.catalogoId)} onSelect={adicionarDoCatalogo} />

          <div className="space-y-2 mt-3">
            {carregando && <p className="text-sm text-ink-subtle text-center py-4">Carregando itens…</p>}
            {!carregando && itens.length === 0 && <p className="text-sm text-ink-subtle text-center py-4 italic">Nenhum item. Busque um serviço ou produto acima.</p>}
            {itens.map((it) => {
              const valorFinal = calcularValorFinalTabela(it.tipoPreco, it.valorFixo === "" ? 0 : Number(it.valorFixo), it.descontoPercent === "" ? 0 : Number(it.descontoPercent), it.valorPadrao);
              return (
                <div key={it._id} className="border border-surface-border rounded-lg p-3 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", it.kind === "SERVICO" ? "bg-primary-50 text-primary-700" : "bg-violet-50 text-violet-700")}>{it.kind === "SERVICO" ? "Serviço" : "Produto"}</span>
                      <span className="text-sm font-medium text-ink truncate">{it.nome}</span>
                      {it.inativo && <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded" title="Inativo no catálogo: o preço continua valendo nesta tabela">inativo</span>}
                      <span className="text-xs text-ink-subtle">(padrão {formatarMoeda(it.valorPadrao)})</span>
                    </div>
                    <button type="button" onClick={() => setItens((a) => a.filter((x) => x._id !== it._id))} className="p-1.5 text-ink-muted hover:text-red-600" aria-label={`Tirar ${it.nome} da tabela`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <FormGrid cols={3}>
                    <FormField label="Tipo de preço">
                      <Select value={it.tipoPreco} onChange={(e) => patch(it._id, { tipoPreco: e.target.value as ItemEdit["tipoPreco"] })}>
                        <option value="VALOR_FIXO">Valor fixo</option>
                        <option value="DESCONTO_PERCENTUAL">Desconto percentual</option>
                      </Select>
                    </FormField>
                    {it.tipoPreco === "VALOR_FIXO" ? (
                      <FormField label="Valor (R$)"><Input type="number" min="0" step="0.01" value={it.valorFixo} onChange={(e) => patch(it._id, { valorFixo: e.target.value })} /></FormField>
                    ) : (
                      <FormField label="Desconto (%)"><Input type="number" min="0" max="100" step="0.01" value={it.descontoPercent} onChange={(e) => patch(it._id, { descontoPercent: e.target.value })} /></FormField>
                    )}
                    <FormField label="Valor final">
                      <div className="input-base bg-surface-alt font-semibold text-success-700 flex items-center">{formatarMoeda(valorFinal)}</div>
                    </FormField>
                  </FormGrid>
                  <ToggleSwitch label="Preço bloqueado (este item)" checked={it.bloqueado} onChange={(v) => patch(it._id, { bloqueado: v })} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function BuscaCatalogo({ catalogo, jaAdicionados, onSelect }: { catalogo: CatalogoItem[]; jaAdicionados: string[]; onSelect: (c: CatalogoItem) => void }) {
  const [query, setQuery] = useState("");
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtrados = catalogo.filter((c) => !jaAdicionados.includes(c.id) && (!q || c.nome.toLowerCase().includes(q)));

  return (
    <div className="relative" ref={ref}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        placeholder="Buscar serviço ou produto para adicionar..."
        className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
      />
      {aberto && filtrados.length > 0 && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border border-surface-border rounded-lg shadow-card-hover">
          {filtrados.slice(0, 20).map((c) => (
            <button key={c.id} type="button" onClick={() => { onSelect(c); setQuery(""); setAberto(false); }}
              className="w-full text-left px-3 py-2 hover:bg-primary-50 border-b border-surface-border last:border-0 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 min-w-0">
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", c.kind === "SERVICO" ? "bg-primary-50 text-primary-700" : "bg-violet-50 text-violet-700")}>{c.kind === "SERVICO" ? "S" : "P"}</span>
                <span className="text-sm text-ink truncate">{c.nome}</span>
              </span>
              <span className="text-xs font-mono text-ink-muted shrink-0">{formatarMoeda(c.valorPadrao)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
