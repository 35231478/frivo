"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { cn, formatarData, formatarMoeda, LABELS_STATUS_PEDIDO_COMPRA, CLASSE_STATUS_PEDIDO_COMPRA } from "@/lib/utils";
import { ShoppingCart, Plus, Trash2, X, Check, MessageCircle, AlertCircle } from "lucide-react";

interface Produto { id: string; nome: string; unidade?: string | null; valorPadrao?: unknown }
interface Usuario { id: string; nome: string; role: string }
interface ItemForm { _id: string; produtoId: string; descricao: string; quantidade: number; unidade: string; valorEstimado: string }
interface Pedido {
  id: string; numero: string; status: string; prazoNecessario?: string | null;
  comprador?: { id: string; nome: string } | null;
  itens: { id: string; descricao: string; quantidade: unknown; unidade: string }[];
}

function uid() { return Math.random().toString(36).slice(2); }

export function ComprasSecao({ ordemServicoId, orcamentoId }: { ordemServicoId?: string; orcamentoId?: string }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const [itens, setItens] = useState<ItemForm[]>([{ _id: uid(), produtoId: "", descricao: "", quantidade: 1, unidade: "un", valorEstimado: "" }]);
  const [prazo, setPrazo] = useState("");
  const [compradorId, setCompradorId] = useState("");
  const [observacao, setObservacao] = useState("");

  const query = ordemServicoId ? `ordemServicoId=${ordemServicoId}` : `orcamentoId=${orcamentoId}`;

  function carregar() {
    fetch(`/api/pedidos-compra?${query}`).then((r) => r.json()).then((d) => setPedidos(Array.isArray(d) ? d : [])).catch(() => {});
  }

  useEffect(() => {
    carregar();
    fetch("/api/produtos").then((r) => r.json()).then((d) => setProdutos(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/usuarios").then((r) => r.json()).then((d) => setUsuarios(Array.isArray(d) ? d : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchItem(id: string, patch: Partial<ItemForm>) {
    setItens((p) => p.map((it) => (it._id === id ? { ...it, ...patch } : it)));
  }
  function selecionarProduto(id: string, produtoId: string) {
    const prod = produtos.find((p) => p.id === produtoId);
    patchItem(id, {
      produtoId,
      descricao: prod ? prod.nome : "",
      unidade: prod?.unidade ?? "un",
    });
  }

  async function salvar() {
    setErro("");
    const itensValidos = itens.filter((i) => i.descricao.trim());
    if (itensValidos.length === 0) return setErro("Adicione ao menos um item com descrição.");

    const payload = {
      ordemServicoId: ordemServicoId ?? null,
      orcamentoId: orcamentoId ?? null,
      compradorId: compradorId || null,
      prazoNecessario: prazo || null,
      observacao: observacao.trim() || null,
      itens: itensValidos.map((i) => ({
        produtoId: i.produtoId || null,
        descricao: i.descricao.trim(),
        quantidade: Number(i.quantidade) || 1,
        unidade: i.unidade,
        valorEstimado: i.valorEstimado === "" ? null : Number(i.valorEstimado),
      })),
    };

    setSalvando(true);
    try {
      const res = await fetch("/api/pedidos-compra", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Erro ao solicitar."); return; }
      const data = await res.json();
      if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener");
      setAberto(false);
      setItens([{ _id: uid(), produtoId: "", descricao: "", quantidade: 1, unidade: "un", valorEstimado: "" }]);
      setPrazo(""); setCompradorId(""); setObservacao("");
      carregar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary-600" /> Compras</h3>
        {!aberto && (
          <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
            <Plus className="w-4 h-4" /> Solicitar compra de material
          </Button>
        )}
      </div>

      {aberto && (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-700">Novo pedido de compra</h4>
            <button onClick={() => setAberto(false)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{erro}</div>}

          <div className="space-y-2">
            {itens.map((it) => (
              <div key={it._id} className="grid grid-cols-12 gap-2 items-end bg-white border border-surface-border rounded-lg p-2">
                <div className="col-span-12 sm:col-span-4">
                  <label className="text-[11px] text-ink-muted">Produto</label>
                  <Select value={it.produtoId} onChange={(e) => selecionarProduto(it._id, e.target.value)} placeholder="Manual / digitar">
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </Select>
                </div>
                <div className="col-span-12 sm:col-span-4">
                  <label className="text-[11px] text-ink-muted">Descrição</label>
                  <Input value={it.descricao} onChange={(e) => patchItem(it._id, { descricao: e.target.value })} placeholder="Descrição do material" />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <label className="text-[11px] text-ink-muted">Qtd</label>
                  <Input type="number" min="0" step="0.01" value={it.quantidade} onChange={(e) => patchItem(it._id, { quantidade: Number(e.target.value) })} />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <label className="text-[11px] text-ink-muted">Un.</label>
                  <Input value={it.unidade} onChange={(e) => patchItem(it._id, { unidade: e.target.value })} />
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <label className="text-[11px] text-ink-muted">Estim.</label>
                  <Input type="number" min="0" step="0.01" value={it.valorEstimado} onChange={(e) => patchItem(it._id, { valorEstimado: e.target.value })} placeholder="R$" />
                </div>
                <div className="col-span-1 flex justify-center pb-1.5">
                  <button type="button" onClick={() => setItens((p) => p.filter((x) => x._id !== it._id))} className="p-1.5 text-ink-muted hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setItens((p) => [...p, { _id: uid(), produtoId: "", descricao: "", quantidade: 1, unidade: "un", valorEstimado: "" }])}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 px-2 py-1">
              <Plus className="w-4 h-4" /> Adicionar item
            </button>
          </div>

          <FormGrid cols={3}>
            <FormField label="Prazo necessário"><Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></FormField>
            <FormField label="Comprador responsável">
              <Select value={compradorId} onChange={(e) => setCompradorId(e.target.value)} placeholder="Selecione">
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          <FormField label="Observação"><Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} /></FormField>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button loading={salvando} onClick={salvar}><MessageCircle className="w-4 h-4" /> Solicitar e notificar comprador</Button>
          </div>
        </div>
      )}

      {pedidos.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-6">Nenhum pedido de compra para este registro.</p>
      ) : (
        <div className="divide-y divide-surface-border border border-surface-border rounded-lg">
          {pedidos.map((p) => (
            <Link key={p.id} href={`/compras/pedidos/${p.id}`} className="flex items-center justify-between px-3 py-2.5 hover:bg-surface-alt transition-colors">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold text-primary-600">{p.numero}</p>
                <p className="text-xs text-ink-muted truncate">
                  {p.itens.map((i) => `${i.descricao} (${Number(i.quantidade)} ${i.unidade})`).join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {p.prazoNecessario && <span className="text-xs text-ink-muted hidden sm:inline">{formatarData(p.prazoNecessario)}</span>}
                <span className={cn(CLASSE_STATUS_PEDIDO_COMPRA[p.status])}>{LABELS_STATUS_PEDIDO_COMPRA[p.status]}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
