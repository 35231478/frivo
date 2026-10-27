"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { InputData } from "@/components/ui/input-data";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { MOTIVO_AVULSO_PADRAO, textoUltimaCompra, valorSugerido, type PedidoTela, type UltimaCompra } from "@/lib/compras/pedido";

interface ItemForm {
  _k: string;
  id: string | null;
  produtoId: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  valorEstimado: string;
  /** Produto escolhido agora: o estimado vem da última compra (até a pessoa mexer nele) */
  _auto: boolean;
}

let seq = 0;
const novoItem = (): ItemForm => ({ _k: `n${++seq}`, id: null, produtoId: "", descricao: "", quantidade: "1", unidade: "un", valorEstimado: "", _auto: false });
const doPedido = (i: PedidoTela["itens"][number]): ItemForm => ({
  _k: i.id, id: i.id, produtoId: i.produtoId ?? "", descricao: i.descricao, quantidade: String(i.quantidade), unidade: i.unidade,
  valorEstimado: i.valorEstimado == null ? "" : String(i.valorEstimado), _auto: false,
});

const fmtDica = { moeda: formatarMoeda, data: (d: string | Date) => formatarData(d) };

/**
 * Editor do pedido de compra — o mesmo para criar (na OS, no orçamento ou avulso) e para editar
 * inline depois de "Solicitado": itens (produto, descrição, qtd, un.), valor estimado com a dica da
 * última compra, prazo, comprador (só quem tem Compras), fornecedor, motivo (avulso) e observação.
 */
export function EditorPedido({ pedido, ordemServicoId, orcamentoId, avulso, onSalvo, onCancelar }: {
  /** Editando este pedido; sem ele, cria um novo */
  pedido?: PedidoTela;
  ordemServicoId?: string;
  orcamentoId?: string;
  /** Novo PC avulso (sem OS/orçamento): pede o motivo */
  avulso?: boolean;
  onSalvo: (p: PedidoTela & { whatsappUrl?: string | null; mudancas?: string[] }) => void;
  onCancelar: () => void;
}) {
  const editando = !!pedido;
  const ehAvulso = editando ? pedido.origem.tipo === "AVULSO" : !!avulso;
  const { itens: produtos } = useCadastro("produtos");
  const { itens: fornecedores } = useCadastro("fornecedores");
  const [compradores, setCompradores] = useState<{ id: string; nome: string }[] | null>(null);
  const [ultimas, setUltimas] = useState<Record<string, UltimaCompra | null>>({});

  const [itens, setItens] = useState<ItemForm[]>(() => (pedido ? pedido.itens.map(doPedido) : [novoItem()]));
  const [prazo, setPrazo] = useState(pedido?.prazoNecessario ?? "");
  const [compradorId, setCompradorId] = useState(pedido?.comprador?.id ?? "");
  const [fornecedorId, setFornecedorId] = useState(pedido?.fornecedor?.id ?? "");
  const [motivo, setMotivo] = useState(pedido?.motivo ?? (ehAvulso ? MOTIVO_AVULSO_PADRAO : ""));
  const [observacao, setObservacao] = useState(pedido?.observacao ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/compras/compradores").then((r) => r.json()).then((d) => setCompradores(Array.isArray(d) ? d : [])).catch(() => setCompradores([]));
  }, []);

  // Última compra dos produtos escolhidos (busca só os que ainda não vieram)
  const ids = useMemo(() => [...new Set(itens.map((i) => i.produtoId).filter(Boolean))].sort().join(","), [itens]);
  useEffect(() => {
    const faltam = ids.split(",").filter((id) => id && !(id in ultimas));
    if (!faltam.length) return;
    let vivo = true;
    fetch(`/api/compras/ultima-compra?produtoIds=${encodeURIComponent(faltam.join(","))}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Record<string, UltimaCompra>) => {
        if (!vivo) return;
        // Sem histórico também fica guardado (null), para não buscar de novo
        setUltimas((u) => ({ ...u, ...Object.fromEntries(faltam.map((id) => [id, d?.[id] ?? null])) }));
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [ids, ultimas]);

  // Produto escolhido agora + histórico chegou: o estimado vira o da última compra (sugestão, editável)
  useEffect(() => {
    setItens((lista) => {
      let mudou = false;
      const nova = lista.map((it) => {
        const u = it._auto && it.produtoId ? ultimas[it.produtoId] : undefined;
        if (u === undefined) return it;
        mudou = true;
        return { ...it, _auto: false, valorEstimado: it.valorEstimado || valorSugerido(u) };
      });
      return mudou ? nova : lista;
    });
  }, [ultimas]);

  function patch(k: string, p: Partial<ItemForm>) {
    setItens((l) => l.map((it) => (it._k === k ? { ...it, ...p } : it)));
  }
  function escolherProduto(k: string, produtoId: string) {
    const prod = produtos.find((p) => p.id === produtoId);
    patch(k, {
      produtoId,
      descricao: prod ? String(prod.nome) : "",
      unidade: typeof prod?.unidade === "string" ? prod.unidade : "un",
      valorEstimado: "",
      _auto: !!produtoId,
    });
  }

  async function salvar() {
    setErro("");
    const validos = itens.filter((i) => i.descricao.trim());
    if (!validos.length) return setErro("Adicione ao menos um item com descrição.");
    if (validos.some((i) => !(Number(i.quantidade.replace(",", ".")) > 0))) return setErro("A quantidade de cada item precisa ser maior que zero.");
    const corpo = {
      ...(editando ? {} : { ordemServicoId: ordemServicoId ?? null, orcamentoId: orcamentoId ?? null }),
      compradorId: compradorId || null,
      fornecedorId: fornecedorId || null,
      prazoNecessario: prazo || null,
      observacao: observacao.trim() || null,
      motivo: ehAvulso ? motivo.trim() || MOTIVO_AVULSO_PADRAO : null,
      itens: validos.map((i) => ({
        id: i.id, produtoId: i.produtoId || null, descricao: i.descricao.trim(),
        quantidade: Number(i.quantidade.replace(",", ".")), unidade: i.unidade.trim() || "un",
        valorEstimado: i.valorEstimado === "" ? null : Number(i.valorEstimado.replace(",", ".")),
      })),
    };
    setSalvando(true);
    try {
      const res = await fetch(editando ? `/api/pedidos-compra/${pedido.id}` : "/api/pedidos-compra", {
        method: editando ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível salvar o pedido."); return; }
      onSalvo(d);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  const semComprador = compradores !== null && compradores.length === 0;
  // Comprador já gravado que perdeu o acesso continua aparecendo (para não sumir sem querer)
  const opcoesComprador = compradores && pedido?.comprador && !compradores.some((c) => c.id === pedido.comprador!.id)
    ? [...compradores, { id: pedido.comprador.id, nome: `${pedido.comprador.nome} (sem acesso a Compras)` }]
    : compradores ?? [];

  return (
    <div className="space-y-4" data-editor-pedido={pedido?.id ?? "novo"}>
      {erro && (
        <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2" role="alert" data-erro-pedido>
          <AlertCircle className="w-4 h-4 shrink-0" />{erro}
        </div>
      )}

      <div className="space-y-2">
        {itens.map((it) => {
          const u = it.produtoId ? ultimas[it.produtoId] : undefined;
          return (
            <div key={it._k} className="grid grid-cols-12 gap-2 items-end bg-white border border-surface-border rounded-lg p-2" data-item-editor>
              <div className="col-span-12 md:col-span-4">
                <label className="text-[11px] text-ink-muted">Produto</label>
                <SeletorCadastro entidade="produtos" itens={produtos} valor={it.produtoId} vazio="Manual / digitar" onChange={(v) => escolherProduto(it._k, v)} />
              </div>
              <div className="col-span-12 md:col-span-3">
                <label className="text-[11px] text-ink-muted">Descrição</label>
                <Input value={it.descricao} onChange={(e) => patch(it._k, { descricao: e.target.value })} placeholder="Descrição do material" data-campo="descricao" />
              </div>
              <div className="col-span-3 md:col-span-1">
                <label className="text-[11px] text-ink-muted">Qtd</label>
                <Input inputMode="decimal" value={it.quantidade} onChange={(e) => patch(it._k, { quantidade: e.target.value })} data-campo="quantidade" />
              </div>
              <div className="col-span-3 md:col-span-1">
                <label className="text-[11px] text-ink-muted">Un.</label>
                <Input value={it.unidade} onChange={(e) => patch(it._k, { unidade: e.target.value })} data-campo="unidade" />
              </div>
              <div className="col-span-5 md:col-span-2">
                <label className="text-[11px] text-ink-muted">Estimado (R$/un.)</label>
                <Input inputMode="decimal" value={it.valorEstimado} onChange={(e) => patch(it._k, { valorEstimado: e.target.value, _auto: false })} placeholder="—" data-campo="valorEstimado" />
              </div>
              <div className="col-span-1 flex justify-center pb-1.5">
                <button type="button" aria-label="Remover item" title="Remover item" onClick={() => setItens((l) => (l.length > 1 ? l.filter((x) => x._k !== it._k) : [novoItem()]))} className="p-1.5 text-ink-muted hover:text-atrasado">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {u && (
                <p className="col-span-12 text-[11px] text-ink-muted -mt-1" data-dica-ultima-compra={it.produtoId}>
                  {textoUltimaCompra(u, fmtDica)}
                  {valorSugerido(u) !== it.valorEstimado && (
                    <button type="button" className="ml-2 font-semibold text-acento hover:underline" onClick={() => patch(it._k, { valorEstimado: valorSugerido(u), _auto: false })} data-usar-ultima-compra>
                      usar
                    </button>
                  )}
                </p>
              )}
            </div>
          );
        })}
        <button type="button" onClick={() => setItens((l) => [...l, novoItem()])} className="inline-flex items-center gap-1.5 text-sm font-medium text-acento hover:underline px-2 py-1" data-adicionar-item>
          <Plus className="w-4 h-4" /> Adicionar item
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <FormField label="Prazo necessário"><InputData value={prazo} onChange={setPrazo} aria-label="Prazo necessário" /></FormField>
        <FormField label="Comprador responsável">
          {semComprador && !pedido?.comprador ? (
            <p className="text-xs text-atencao-texto bg-atencao-claro border border-atencao/30 rounded-lg px-3 py-2" data-sem-comprador>
              Nenhum usuário ativo tem acesso a Compras. Dê a permissão “Compras” a alguém em Configurações › Perfis de acesso.
            </p>
          ) : (
            <Select value={compradorId} onChange={(e) => setCompradorId(e.target.value)} placeholder={compradores === null ? "Carregando…" : "Sem comprador"} data-campo="comprador">
              {opcoesComprador.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          )}
        </FormField>
        <FormField label="Fornecedor" hint="Quem recebe o PC por e-mail/WhatsApp">
          <SeletorCadastro entidade="fornecedores" itens={fornecedores} valor={fornecedorId} vazio="A definir" onChange={(v) => setFornecedorId(v)} />
        </FormField>
        {ehAvulso && (
          <FormField label="Motivo (pedido avulso)">
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={MOTIVO_AVULSO_PADRAO} data-campo="motivo" />
          </FormField>
        )}
      </div>
      <FormField label="Observação"><Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} data-campo="observacao" /></FormField>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
        <Button loading={salvando} onClick={salvar} data-salvar-pedido>{editando ? "Salvar alterações" : "Solicitar compra"}</Button>
      </div>
    </div>
  );
}
