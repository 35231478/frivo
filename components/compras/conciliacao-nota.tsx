"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Link2, Loader2, PackagePlus, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatarMoeda } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";

export interface ItemConciliacao {
  id: string; numeroItem: number; codigoFornecedor: string; descricaoFornecedor: string; ncm: string | null;
  unidade: string; quantidade: number; valorUnitario: number; valorTotal: number;
  produto: { id: string; nome: string; unidade: string } | null;
  /** veio vinculado pelo de-para (aprendido de nota anterior deste fornecedor) */
  aprendido: boolean;
}
type ProdutoBusca = { id: string; nome: string; unidade: string; saldo?: number };
type Escolha = { modo: "existente"; produto: ProdutoBusca } | { modo: "novo"; nome: string; unidade: string } | null;

const mesmaUnidade = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const moeda4 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * Conciliação (de-para) da nota de compra: cada item da NF → produto existente (busca) OU produto
 * novo. Itens que o fornecedor já mandou antes chegam vinculados ("aprendido"). Unidade da nota
 * diferente da do produto: avisa (entra como está na nota; conversão fica para depois).
 */
export function ConciliacaoNota({ notaId, itens, pedidos, podeLancar, motivoSemLancar, parcelas }: {
  notaId: string; itens: ItemConciliacao[]; pedidos: { id: string; numero: string }[];
  podeLancar: boolean; motivoSemLancar?: string | null;
  parcelas: { numero: string; vencimento: string; valor: number }[];
}) {
  const router = useRouter();
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>(() =>
    Object.fromEntries(itens.map((i) => [i.id, i.produto ? { modo: "existente", produto: i.produto } : null])));
  const [pedidoId, setPedidoId] = useState("");
  const [enviando, setEnviando] = useState<"salvar" | "lancar" | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const definir = (id: string, e: Escolha) => { setEscolhas((s) => ({ ...s, [id]: e })); setMsg(null); };
  const vinculados = itens.filter((i) => {
    const e = escolhas[i.id];
    return e && (e.modo === "existente" || e.nome.trim().length >= 2);
  }).length;
  type CorpoItem = { itemId: string; produtoId: string } | { itemId: string; novo: { nome: string; unidade: string | null } };
  const corpoItens = () => itens.flatMap((i): CorpoItem[] => {
    const e = escolhas[i.id];
    if (!e) return [];
    return e.modo === "existente" ? [{ itemId: i.id, produtoId: e.produto.id }] : [{ itemId: i.id, novo: { nome: e.nome.trim(), unidade: e.unidade.trim() || null } }];
  });

  async function enviar(acao: "salvar" | "lancar") {
    setEnviando(acao); setMsg(null);
    try {
      const r = acao === "salvar"
        ? await fetch(`/api/compras/notas/${notaId}/conciliacao`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens: corpoItens() }) })
        : await fetch(`/api/compras/notas/${notaId}/lancar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens: corpoItens(), pedidoCompraId: pedidoId || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: j.erro ?? "Não foi possível concluir." }); return; }
      setMsg({ tipo: "ok", texto: acao === "salvar" ? (j.faltam ? `Vínculos salvos. Faltam ${j.faltam} item(ns).` : "Vínculos salvos: nota conciliada.") : "Nota lançada." });
      router.refresh();
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    } finally { setEnviando(null); }
  }

  const semVinculo = itens.filter((i) => !escolhas[i.id]);
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border bg-surface-alt/40 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">De-para dos itens <span className="text-ink-muted font-normal">· <span data-vinculados>{vinculados}</span> de {itens.length} com produto</span></p>
          {semVinculo.length > 0 && (
            <button type="button" className="text-xs font-semibold text-primary-600 hover:underline" data-criar-todos
              onClick={() => setEscolhas((s) => ({ ...s, ...Object.fromEntries(semVinculo.map((i) => [i.id, { modo: "novo", nome: i.descricaoFornecedor, unidade: i.unidade }])) }))}>
              Criar produto novo para os {semVinculo.length} sem vínculo
            </button>
          )}
        </div>
        <ul className="divide-y divide-surface-border">
          {itens.map((i) => (
            <li key={i.id} data-item={i.numeroItem} className="px-4 py-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-ink-muted">Item {i.numeroItem} · cód. <span className="font-mono">{i.codigoFornecedor}</span>{i.ncm && ` · NCM ${i.ncm}`}</p>
                <p className="text-sm font-semibold text-ink">{i.descricaoFornecedor}</p>
                <p className="text-xs text-ink-muted mt-0.5 tabular-nums">{formatarQtd(i.quantidade)} {i.unidade} × {moeda4(i.valorUnitario)} = <span className="font-semibold text-ink">{formatarMoeda(i.valorTotal)}</span></p>
              </div>
              <Vinculo item={i} escolha={escolhas[i.id]} onChange={(e) => definir(i.id, e)} />
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted mb-1">Contas a pagar que serão geradas</p>
          <ul className="text-sm space-y-0.5" data-parcelas>
            {parcelas.map((p, k) => (
              <li key={k} className="flex justify-between gap-3 tabular-nums"><span className="text-ink-muted">{parcelas.length > 1 ? `Parcela ${k + 1}/${parcelas.length}` : "À vista"} · vence {p.vencimento}</span><span className="font-semibold">{formatarMoeda(p.valor)}</span></li>
            ))}
          </ul>
        </div>
        {pedidos.length > 0 && (
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">Pedido de compra (opcional)</span>
            <select value={pedidoId} onChange={(e) => setPedidoId(e.target.value)} data-pedido
              className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm">
              <option value="">Sem pedido</option>
              {pedidos.map((p) => <option key={p.id} value={p.id}>{p.numero}</option>)}
            </select>
            <span className="text-xs text-ink-muted">O custo real da nota vai para os itens do pedido com o mesmo produto.</span>
          </label>
        )}
      </div>

      {msg && <p role={msg.tipo === "erro" ? "alert" : "status"} className={cn("text-sm font-medium", msg.tipo === "ok" ? "text-success-700" : "text-red-600")}>{msg.texto}</p>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2">
        {!podeLancar && motivoSemLancar && <p className="text-xs text-ink-muted sm:mr-auto" data-sem-lancar>{motivoSemLancar}</p>}
        <Button type="button" variant="secondary" onClick={() => enviar("salvar")} loading={enviando === "salvar"} disabled={!!enviando}>Salvar vínculos</Button>
        <Button type="button" onClick={() => enviar("lancar")} loading={enviando === "lancar"} disabled={!!enviando || !podeLancar || vinculados < itens.length} data-lancar-nota>
          <Check className="w-4 h-4" /> Confirmar e lançar
        </Button>
      </div>
    </div>
  );
}

function Vinculo({ item, escolha, onChange }: { item: ItemConciliacao; escolha: Escolha; onChange: (e: Escolha) => void }) {
  if (escolha?.modo === "existente") {
    const aprendido = item.aprendido && item.produto?.id === escolha.produto.id;
    return (
      <div className="space-y-1.5" data-vinculo="existente">
        <div className="flex items-center gap-2 rounded-lg border border-success-200 bg-success-50/60 px-3 py-2">
          <Link2 className="w-4 h-4 text-success-700 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate">{escolha.produto.nome}</p>
            <p className="text-[11px] text-ink-muted">unidade {escolha.produto.unidade}{aprendido && <span className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-primary-700" data-aprendido><Sparkles className="w-3 h-3" /> aprendido de nota anterior</span>}</p>
          </div>
          <button type="button" onClick={() => onChange(null)} className="text-xs font-medium text-ink-muted hover:text-ink" aria-label="Trocar produto">Trocar</button>
        </div>
        {!mesmaUnidade(escolha.produto.unidade, item.unidade) && (
          <p className="text-[11px] text-amber-700 flex items-start gap-1" data-unidade-divergente>
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> A nota vem em “{item.unidade}” e o produto é em “{escolha.produto.unidade}”: entra {formatarQtd(item.quantidade)} como está na nota (sem conversão).
          </p>
        )}
      </div>
    );
  }
  if (escolha?.modo === "novo") {
    return (
      <div className="rounded-lg border border-primary-200 bg-primary-50/50 px-3 py-2 space-y-2" data-vinculo="novo">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-primary-700 flex items-center gap-1"><PackagePlus className="w-3.5 h-3.5" /> Produto novo</p>
          <button type="button" onClick={() => onChange(null)} className="text-ink-muted hover:text-ink" aria-label="Cancelar produto novo"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Input value={escolha.nome} onChange={(e) => onChange({ ...escolha, nome: e.target.value })} aria-label="Nome do produto novo" name={`novo-nome-${item.numeroItem}`} maxLength={200} />
          <Input value={escolha.unidade} onChange={(e) => onChange({ ...escolha, unidade: e.target.value })} aria-label="Unidade" name={`novo-un-${item.numeroItem}`} maxLength={10} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5" data-vinculo="pendente">
      <BuscaProduto onEscolher={(p) => onChange({ modo: "existente", produto: p })} rotulo={`Buscar produto para o item ${item.numeroItem}`} />
      <button type="button" onClick={() => onChange({ modo: "novo", nome: item.descricaoFornecedor, unidade: item.unidade })}
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline" data-criar-novo={item.numeroItem}>
        <PackagePlus className="w-3.5 h-3.5" /> ou criar produto novo
      </button>
    </div>
  );
}

function BuscaProduto({ onEscolher, rotulo }: { onEscolher: (p: ProdutoBusca) => void; rotulo: string }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProdutoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const pedido = useRef(0);
  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) { setLista([]); return; }
    const n = ++pedido.current;
    const t = setTimeout(async () => {
      setCarregando(true);
      try {
        const r = await fetch(`/api/compras/produtos?q=${encodeURIComponent(termo)}`);
        const j = await r.json().catch(() => ({}));
        if (n === pedido.current) setLista(Array.isArray(j.produtos) ? j.produtos : []);
      } finally { if (n === pedido.current) setCarregando(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto do cadastro…" aria-label={rotulo} className="pl-9" data-busca-produto />
      {carregando && <Loader2 className="w-4 h-4 animate-spin text-ink-subtle absolute right-3 top-1/2 -translate-y-1/2" />}
      {lista.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 w-full bg-white border border-surface-border rounded-lg shadow-card-hover max-h-64 overflow-auto">
          {lista.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { onEscolher(p); setQ(""); setLista([]); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 flex justify-between gap-2" data-opcao-produto={p.id}>
                <span className="truncate">{p.nome}</span><span className="text-xs text-ink-muted shrink-0">{p.unidade}{p.saldo != null && ` · saldo ${formatarQtd(p.saldo)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
