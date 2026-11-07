"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { Dica } from "@/components/ui/dica";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";
import { ComportamentoDoProduto, CustoDoMaterial, useCustosProdutos } from "@/components/estoque/composicao";
import type { ItemCadastro } from "@/lib/cadastros/opcoes";
import { custoDoKit, erroDosItensDoKit, qtd, type ProdutoDaComposicao } from "@/lib/estoque/composicao";
import { formatarMoeda } from "@/lib/utils";

type ProdutoLista = ItemCadastro & ProdutoDaComposicao & { unidade?: string | null };
interface ItemEdit { _id: string; produtoId: string; quantidade: string }
const uid = () => Math.random().toString(36).slice(2);

/** Itens gravados → edição */
const paraEdicao = (itens: unknown): ItemEdit[] =>
  (Array.isArray(itens) ? itens : []).map((it: { produtoId: string; quantidade: unknown }) => ({ _id: uid(), produtoId: it.produtoId, quantidade: String(qtd(it.quantidade)) }));

/**
 * Editor de kit de material (CadastroPadrao › kits-material): nome, descrição e os itens (produto + quantidade).
 * O comportamento de cada item vem da categoria do produto (E3.1) e o custo somado é só referência
 * (último custo de compra × quantidade). Grava pela rota genérica.
 */
export function EditorKitMaterial({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [itens, setItens] = useState<ItemEdit[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  // Só grava os itens depois de carregá-los: salvar com a lista vazia apagaria o kit
  const [itensOk, setItensOk] = useState(false);
  const produtos = useCadastro<ProdutoLista>("produtos");

  useEffect(() => {
    if (!aberto) return;
    setErro(""); setNome(item?.nome ?? ""); setDescricao((item?.descricao as string | null) ?? ""); setItens([]); setItensOk(!item);
    if (!item) return;
    let cancelado = false;
    setCarregando(true);
    fetch(`/api/cadastros/kits-material/${item.id}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => null); if (cancelado) return; if (r.ok && d) { setItens(paraEdicao(d.itens)); setItensOk(true); } else setErro(d?.erro ?? "Não foi possível carregar os itens do kit."); })
      .catch(() => { if (!cancelado) setErro("Erro de conexão ao carregar os itens."); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [aberto, item]);

  const produtoDe = (id: string) => produtos.itens.find((p) => p.id === id) ?? null;
  const ids = useMemo(() => itens.map((i) => i.produtoId).filter(Boolean), [itens]);
  const { custos, carregando: custosCarregando } = useCustosProdutos(ids);
  const custo = custoDoKit({ itens: itens.filter((i) => i.produtoId).map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })) }, custos);
  const patch = (id: string, p: Partial<ItemEdit>) => setItens((arr) => arr.map((i) => (i._id === id ? { ...i, ...p } : i)));

  async function salvar() {
    if (!nome.trim()) { setErro("Informe o nome do kit."); return; }
    if (!itensOk) { setErro("Os itens do kit não carregaram: feche e abra de novo antes de salvar."); return; }
    const problema = erroDosItensDoKit(itens);
    if (problema) { setErro(problema); return; }
    setSalvando(true); setErro("");
    const r = await salvarCadastro("kits-material", item?.id ?? null, {
      nome: nome.trim(), descricao: descricao.trim() || null,
      itens: itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : "Novo kit de material"}
      largura="w-full sm:w-[58vw] sm:min-w-[520px] sm:max-w-[860px]"
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} disabled={carregando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Criar"}</Button>
      </>}
    >
      <div className="space-y-4" data-editor-kit>
        {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">{erro}</div>}
        {item && item.ativo === false && <p className="text-sm bg-atencao-claro border border-atencao/20 text-atencao-texto rounded-lg px-3 py-2">Kit inativo: os serviços que já o usam continuam com ele; ele só não é oferecido em composições novas.</p>}

        <FormField label="Nome" required><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Kit instalação split 12k" maxLength={120} /></FormField>
        <FormField label="Descrição"><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} maxLength={1000} /></FormField>

        <div>
          <div className="flex items-center gap-1 mb-2">
            <h5 className="text-xs font-bold text-ink-muted uppercase tracking-wider">Itens do kit</h5>
            <Dica rotulo="Itens do kit" texto="Produto + quantidade por kit. O comportamento (venda à parte / incluso) é o da categoria de cada produto. O kit é vivo: mudar aqui muda em todos os serviços que o usam; no orçamento/OS ele vira uma cópia editável." />
          </div>
          <div className="space-y-2">
            {carregando && <p className="text-sm text-ink-subtle text-center py-4">Carregando itens…</p>}
            {!carregando && itens.length === 0 && <p className="text-sm text-ink-subtle text-center py-3 italic">Nenhum item. Adicione os produtos do kit.</p>}
            {itens.map((it) => {
              const p = produtoDe(it.produtoId);
              return (
                <div key={it._id} className="border border-surface-border rounded-lg p-3 bg-white grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-2 items-end" data-item-kit>
                  <FormField label="Produto" required>
                    <SeletorCadastro entidade="produtos" itens={produtos.itens} valor={it.produtoId} onChange={(v) => patch(it._id, { produtoId: v })} nome="produtoId" semCriar />
                  </FormField>
                  <FormField label={`Quantidade${p?.unidade ? ` (${p.unidade})` : ""}`} required>
                    <Input type="text" inputMode="decimal" value={it.quantidade} onChange={(e) => patch(it._id, { quantidade: e.target.value })} placeholder="1" data-quantidade-item />
                  </FormField>
                  <div className="flex items-center justify-between sm:justify-end gap-2 pb-2">
                    {p && <ComportamentoDoProduto produto={p} />}
                    {p && <CustoDoMaterial produtoId={p.id} quantidade={qtd(it.quantidade)} custos={custos} />}
                    <button type="button" onClick={() => setItens((a) => a.filter((x) => x._id !== it._id))} className="p-1.5 text-ink-muted hover:text-atrasado" aria-label={`Tirar ${p?.nome ?? "item"} do kit`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setItens((a) => [...a, { _id: uid(), produtoId: "", quantidade: "1" }])} data-acao="add-item-kit"><Plus className="w-4 h-4" /> Adicionar produto</Button>
            {itens.length > 0 && (
              <span className="text-sm text-ink-muted flex items-center gap-1" data-custo-kit={custo.total}>
                Custo de referência: <strong className="tabular-nums text-ink">{custosCarregando && !custos.size ? "…" : formatarMoeda(custo.total)}</strong>
                {custo.semCusto.length > 0 && <span className="text-[11px] text-atencao-texto">({custo.semCusto.length} sem custo de compra)</span>}
                <Dica rotulo="Custo de referência" texto="Soma do último custo de compra × quantidade dos itens. Só referência: não altera preço nenhum." />
              </span>
            )}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
