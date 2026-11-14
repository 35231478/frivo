"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";
import { CampoNumero } from "@/components/orcamento/itens-tabela";
import { EditarNoContexto, FaixaDaEdicao, type EdicaoDoSelecionado } from "@/components/ui/select-cadastro-rapido";
import { motivoDaLinhaDaOs, motivoDaTrava, numeroDoCampo, numeroParaCampo, rotuloDaEdicao, type SituacaoDoRegistro } from "@/lib/edicao-contexto";
import { MateriaisLinha } from "@/components/orcamento/materiais-linha";
import type { ItemCadastro } from "@/lib/cadastros/opcoes";
import { valorDaLinha, type MaterialOrcamento } from "@/lib/orcamentos/materiais";
import { unitarioParaEdicao } from "@/lib/os/materiais";
import { cn, formatarMoeda } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { Plus, X, Check, CheckCircle, Lock, Trash2, Package, Wrench } from "lucide-react";

type Tipo = "SERVICO" | "PRODUTO";
interface ItemOs {
  id: string; descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; executado: boolean;
  tipo?: Tipo | null; servicoId?: string | null; produtoId?: string | null; orcamentoServicoId?: string | null;
  valorBase?: unknown; ajusteMateriais?: unknown; valorManual?: boolean | null; materialId?: string | null;
  materiais?: (MaterialOrcamento & { id: string })[] | null; material?: { osItemId: string } | null;
  pecas?: ItemOs[];
}
/** O item em edição (novo ou existente): o unitário é o BASE quando há materiais */
interface Edicao { id?: string; tipo: Tipo; servicoId: string | null; produtoId: string | null; descricao: string; quantidade: number; valorUnitario: number; valorTotal?: number | null; valorManual: boolean; materiais?: MaterialOrcamento[]; origemPreco?: string }

const num = (v: unknown) => Number(v ?? 0) || 0;
const uid = () => Math.random().toString(36).slice(2);
/** O que identifica a edição da linha: USO — vale só nesta OS, o catálogo não muda */
const ALVO_LINHA = "este item da OS";

/**
 * Itens da OS (aba Comercial). E3.3b: além da linha livre, serviço e produto do catálogo com o preço do cliente; o
 * serviço com composição entra com o painel "Materiais e peças" (kit explodido, snapshot editável): material incluso
 * ajusta a linha do serviço; peça vira item PRODUTO derivado, cobrado à parte. Item que veio do orçamento aprovado é
 * só leitura (como sempre), com o snapshot copiado à vista. Marcar executado continua igual. Sem baixa de estoque.
 *
 * Leva 2 da padronização — a linha é USO: o lápis abre "Editando este item da OS" (descrição, quantidade e o
 * preço aplicado NESTA OS; o catálogo nunca muda). Registro fechado (OS concluída, assinada, faturada ou com
 * nota) trava as linhas: cadeado com o motivo no ⓘ, e nada entra nem sai. O servidor confere de novo.
 */
export function OsOrcamento({ osId, itens: iniciais, clienteId = null, situacao = null }: {
  osId: string; itens: ItemOs[]; clienteId?: string | null;
  /** A situação da OS para a trava de registro fechado (lib/edicao-contexto › situacaoDaOs) */
  situacao?: SituacaoDoRegistro | null;
}) {
  const fechada = motivoDaTrava(situacao);
  // RBAC: quem não edita OS vê os itens, sem lápis, lixeira nem "novo item" (o servidor recusa de qualquer jeito)
  const podeEditar = usePermissoes().pode("ordens", "editar");
  const [itens, setItens] = useState<ItemOs[]>(iniciais);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [modo, setModo] = useState<"livre" | "servico" | "produto" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const produtos = useCadastro<ItemCadastro>("produtos");

  const total = itens.reduce((acc, i) => acc + num(i.valorTotal), 0);
  const totalExecutado = itens.filter((i) => i.executado).reduce((acc, i) => acc + num(i.valorTotal), 0);
  const totalServicos = itens.filter((i) => (i.tipo ?? "SERVICO") === "SERVICO").reduce((acc, i) => acc + num(i.valorTotal), 0);
  const totalProdutos = total - totalServicos;
  const nomeDoServico = useMemo(() => new Map(itens.map((i) => [i.id, i.descricao])), [itens]);

  async function chamar(url: string, init: RequestInit) {
    setSalvando(true); setErro("");
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErro(d?.erro ?? "Não foi possível gravar."); return null; }
      return d;
    } catch { setErro("Erro de conexão. Tente novamente."); return null; } finally { setSalvando(false); }
  }
  const corpo = (e: Edicao) => ({
    tipo: e.tipo, servicoId: e.servicoId, produtoId: e.produtoId, descricao: e.descricao.trim(), quantidade: e.quantidade, valorUnitario: e.valorUnitario,
    ...(e.materiais?.length ? { valorTotal: valorDaLinha(e).valorTotal, valorManual: e.valorManual, materiais: e.materiais.map(({ id: _id, ...m }) => ({ ...m, kitNome: m.kitNome ?? null, custoUnit: m.custoUnit ?? null })) } : {}),
  });
  /** Resposta do servidor (item + peças derivadas) → lista: substitui o item e as peças dele */
  const aplicar = (d: ItemOs & { pecas?: ItemOs[] }, idAntigo?: string) => {
    const { pecas = [], ...item } = d;
    setItens((prev) => {
      const sem = prev.filter((i) => i.id !== (idAntigo ?? item.id) && i.material?.osItemId !== (idAntigo ?? item.id));
      const idx = idAntigo ? prev.findIndex((i) => i.id === idAntigo) : -1;
      const novos = [item, ...pecas];
      if (idx < 0) return [...sem, ...novos];
      const pos = sem.findIndex((i) => prev.indexOf(i) > idx);
      return pos < 0 ? [...sem, ...novos] : [...sem.slice(0, pos), ...novos, ...sem.slice(pos)];
    });
  };

  async function salvar() {
    if (!edicao) return;
    if (!edicao.descricao.trim()) { setErro("Preencha a descrição."); return; }
    if (!(edicao.quantidade > 0)) { setErro("Quantidade deve ser maior que zero."); return; }
    const d = edicao.id
      ? await chamar(`/api/ordens/${osId}/orcamento/${edicao.id}`, { method: "PUT", body: JSON.stringify(corpo(edicao)) })
      : await chamar(`/api/ordens/${osId}/orcamento`, { method: "POST", body: JSON.stringify(corpo(edicao)) });
    if (!d) return;
    aplicar(d, edicao.id);
    setEdicao(null); setModo(null);
  }
  async function remover(item: ItemOs) {
    const d = await chamar(`/api/ordens/${osId}/orcamento/${item.id}`, { method: "DELETE" });
    if (d) setItens((prev) => prev.filter((i) => i.id !== item.id && i.material?.osItemId !== item.id));
  }
  async function marcarExecutado(itemId: string) {
    const d = await chamar(`/api/ordens/${osId}/orcamento/${itemId}`, { method: "PUT", body: JSON.stringify({ executado: true }) });
    if (d) setItens((p) => p.map((i) => (i.id === itemId ? { ...i, ...d } : i)));
  }
  async function doCatalogo(p: { servicoId?: string; produtoId?: string }) {
    const qs = p.servicoId ? `servicoId=${encodeURIComponent(p.servicoId)}` : `produtoId=${encodeURIComponent(p.produtoId!)}`;
    const d = await chamar(`/api/ordens/${osId}/orcamento/catalogo?${qs}`, { method: "GET" });
    if (!d) return;
    setEdicao({
      tipo: d.tipo, servicoId: d.servicoId ?? null, produtoId: d.produtoId ?? null, descricao: d.descricao, quantidade: 1, valorUnitario: num(d.valorUnitario), valorManual: false, origemPreco: d.origemPreco,
      materiais: d.tipo === "SERVICO" && Array.isArray(d.materiais) && d.materiais.length ? d.materiais.map((m: MaterialOrcamento) => ({ ...m, id: uid() })) : undefined,
    });
  }
  const editar = (i: ItemOs) => {
    setModo(null);
    setEdicao({
      id: i.id, tipo: i.tipo ?? "SERVICO", servicoId: i.servicoId ?? null, produtoId: i.produtoId ?? null, descricao: i.descricao, quantidade: num(i.quantidade),
      valorUnitario: unitarioParaEdicao(i), valorTotal: num(i.valorTotal), valorManual: !!i.valorManual,
      materiais: i.materiais?.length ? i.materiais.map((m) => ({ ...m, quantidade: num(m.quantidade), quantidadePadrao: num(m.quantidadePadrao), valorVendaUnit: num(m.valorVendaUnit), custoUnit: m.custoUnit == null ? null : num(m.custoUnit) })) : (i.tipo ?? "SERVICO") === "SERVICO" && i.servicoId ? [] : undefined,
    });
  };
  const buscarAvulso = async (produtoId: string) => {
    const res = await fetch(`/api/ordens/${osId}/orcamento/catalogo?produtoId=${encodeURIComponent(produtoId)}`, { cache: "no-store" });
    const d = await res.json().catch(() => null);
    return res.ok && d?.material ? { material: d.material } : { erro: d?.erro ?? "Não foi possível adicionar o material." };
  };

  /** A edição da linha como USO, no painel da leva 1: só o que mudou vai para o servidor */
  const edicaoDaLinha = (i: ItemOs, motivo: string | null): EdicaoDoSelecionado => {
    const comMateriais = !!i.materiais?.length;
    return {
      escopo: "uso", alvo: ALVO_LINHA, travado: motivo, permissao: { modulo: "ordens", acao: "editar" }, mensagemSucesso: "Item da OS atualizado.",
      campos: [
        { nome: "descricao", label: "Descrição", obrigatorio: true, tipo: "textarea", maxLength: 500 },
        { nome: "quantidade", label: "Quantidade", obrigatorio: true, colunas: 3, inputMode: "decimal" },
        // Linha com total digitado à mão: o preço é esse total (muda em "Materiais e peças")
        ...(i.valorManual && comMateriais ? [] : [{ nome: "valorUnitario", label: comMateriais ? "Unit. base (R$)" : "Valor unitário (R$)", obrigatorio: true, colunas: 3 as const, inputMode: "decimal" as const }]),
      ],
      valores: () => ({ descricao: i.descricao, quantidade: numeroParaCampo(num(i.quantidade)), valorUnitario: numeroParaCampo(unitarioParaEdicao(i), 2) }),
      async salvar(id, valores, alterados) {
        const corpo: Record<string, unknown> = {};
        for (const k of alterados) corpo[k] = k === "descricao" ? valores[k] : numeroDoCampo(valores[k]);
        if ("quantidade" in corpo && !(Number(corpo.quantidade) > 0)) throw new Error("Quantidade deve ser maior que zero.");
        if ("valorUnitario" in corpo && corpo.valorUnitario === null) throw new Error("Valor unitário inválido.");
        const res = await fetch(`/api/ordens/${osId}/orcamento/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
        const d = await res.json().catch(() => null);
        if (!res.ok || !d?.id) throw new Error(d?.erro ?? "Não foi possível salvar o item.");
        setItens((prev) => prev.map((x) => (x.id === id ? { ...x, ...d } : x)));
      },
      // O serviço com (ou que pode ter) materiais: o editor completo continua nesta tela
      acaoSecundaria: () => ((i.tipo ?? "SERVICO") === "SERVICO" ? { rotulo: "Materiais e peças deste item", onClick: () => editar(i) } : null),
    };
  };

  const v = edicao ? valorDaLinha(edicao) : null;
  const totalEdicao = v ? (edicao!.materiais?.length ? v.valorTotal : (edicao!.quantidade || 0) * (edicao!.valorUnitario || 0)) : 0;

  return (
    <div className="space-y-4" data-itens-os>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-page rounded-lg p-3 text-sm">
        <div><span className="text-ink-muted">Total:</span> <span className="font-bold text-ink" data-total-os>{formatarMoeda(total)}</span>
          {totalProdutos > 0 && <span className="text-ink-muted"> · serviços <span data-total-servicos>{formatarMoeda(totalServicos)}</span> · peças/produtos <span data-total-produtos>{formatarMoeda(totalProdutos)}</span></span>}
        </div>
        <div><span className="text-ink-muted">Executado:</span> <span className="font-bold text-ok-texto">{formatarMoeda(totalExecutado)}</span></div>
      </div>

      {erro && <p className="text-sm text-atrasado bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-orcamento>{erro}</p>}

      {itens.length === 0 && !edicao && !modo && (
        <p className="text-sm text-ink-muted text-center py-6">Nenhum item na OS.</p>
      )}

      <div className="divide-y divide-surface-linha border border-surface-border rounded-lg overflow-hidden">
        {itens.map((i) => {
          const derivada = !!i.materialId;
          const doOrcamento = !!i.orcamentoServicoId;
          // Por que esta linha não se edita (registro fechado ou motivo da própria linha) — null = edita
          const motivo = motivoDaLinhaDaOs(i, situacao);
          const emEdicao = edicao?.id === i.id;
          return (
            <div key={i.id} className={cn(i.executado && "bg-ok-claro/60", derivada && "bg-surface-page/60")} data-item-os={i.id} data-tipo-item={i.tipo ?? "SERVICO"} data-linha-derivada={derivada ? "true" : undefined}>
              <div className="px-3 py-2 text-sm sm:flex sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                  {(i.tipo ?? "SERVICO") === "PRODUTO" ? <Package className="w-3.5 h-3.5 text-ink-subtle shrink-0" aria-hidden /> : <Wrench className="w-3.5 h-3.5 text-ink-subtle shrink-0" aria-hidden />}
                  <span className="text-ink truncate">{i.descricao}</span>
                  {derivada && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-acento-claro text-acento" data-peca-de={nomeDoServico.get(i.material?.osItemId ?? "") ?? ""}>Peça · {nomeDoServico.get(i.material?.osItemId ?? "") ?? "serviço"}</span>}
                  {doOrcamento && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">Do orçamento</span>}
                  {!!i.materiais?.length && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted" data-com-materiais>{i.materiais.length} materiais · ajuste {formatarMoeda(num(i.ajusteMateriais))}</span>}
                  {i.valorManual && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-atencao-claro text-atencao-texto">Valor manual</span>}
                </div>
                <div className="mt-1 sm:mt-0 flex flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end shrink-0">
                <span className="text-ink-muted tabular-nums"><span className="text-[10px] uppercase text-ink-subtle mr-1">Qtd</span>{" "}{num(i.quantidade)}</span>
                <span className="text-ink-muted tabular-nums"><span className="text-[10px] uppercase text-ink-subtle mr-1">Unit.</span>{" "}{formatarMoeda(num(i.valorUnitario))}</span>
                <span className="font-medium text-ink tabular-nums" data-total-item><span className="text-[10px] uppercase text-ink-subtle mr-1">Total</span>{" "}{formatarMoeda(num(i.valorTotal))}</span>
                <span className="text-center">
                  {i.executado ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-ok-texto bg-ok-claro px-1.5 py-0.5 rounded-full"><CheckCircle className="w-3 h-3" /> Executado</span>
                  ) : podeEditar && (
                    <Button type="button" variant="ghost" onClick={() => marcarExecutado(i.id)} className="text-[10px] h-6 px-2 text-acento">Marcar executado</Button>
                  )}
                </span>
                <span className="flex items-center justify-end gap-0.5" data-acoes-item>
                  {/* USO: "Editando este item da OS". Travada: cadeado com o motivo no ⓘ */}
                  {!emEdicao && <EditarNoContexto id={i.id} rotulo={`Editar ${i.descricao}`} edicao={edicaoDaLinha(i, motivo)} />}
                  {!motivo && podeEditar && <button type="button" onClick={() => remover(i)} className="p-1 text-ink-muted hover:text-atrasado" aria-label={`Excluir ${i.descricao}`}><Trash2 className="w-3.5 h-3.5" /></button>}
                </span>
                </div>
              </div>
              {/* Snapshot do item que veio do orçamento: à vista, sem edição */}
              {doOrcamento && !!i.materiais?.length && (
                <div className="px-3 pb-2"><MateriaisLinha item={{ id: i.id, descricao: i.descricao, quantidade: num(i.quantidade), valorUnitario: unitarioParaEdicao(i), valorTotal: num(i.valorTotal), valorManual: !!i.valorManual, materiais: i.materiais.map((m) => ({ ...m, quantidade: num(m.quantidade), quantidadePadrao: num(m.quantidadePadrao), valorVendaUnit: num(m.valorVendaUnit), custoUnit: m.custoUnit == null ? null : num(m.custoUnit) })) }} clienteId={clienteId} catalogoProdutos={[]} onChange={() => {}} somenteLeitura /></div>
              )}
              {emEdicao && edicao && <FormItem edicao={edicao} setEdicao={setEdicao} total={totalEdicao} salvar={salvar} cancelar={() => setEdicao(null)} salvando={salvando} clienteId={clienteId} produtos={produtos.itens} buscarAvulso={buscarAvulso} />}
            </div>
          );
        })}
      </div>

      {/* Novo item */}
      {!edicao?.id && (modo || edicao) && (
        <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-3" data-novo-item>
          {!edicao && modo === "servico" && (
            <FormField label="Serviço do catálogo" dica="Preço da tabela do cliente, se ele tiver uma (senão o valor padrão). Serviço com composição entra com os materiais e peças.">
              <SeletorCadastro entidade="servicos" valor="" onChange={(v) => v && void doCatalogo({ servicoId: v })} nome="servicoId" placeholder={salvando ? "Carregando…" : "Escolha o serviço…"} semCriar disabled={salvando} />
            </FormField>
          )}
          {!edicao && modo === "produto" && (
            <FormField label="Produto do catálogo" dica="Preço da tabela do cliente, se ele tiver uma (senão o valor padrão). Entra como item de produto, cobrado à parte.">
              <SeletorCadastro entidade="produtos" itens={produtos.itens} valor="" onChange={(v) => v && void doCatalogo({ produtoId: v })} nome="produtoId" placeholder={salvando ? "Carregando…" : "Escolha o produto…"} semCriar disabled={salvando} />
            </FormField>
          )}
          {!edicao && modo === "livre" && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setEdicao({ tipo: "SERVICO", servicoId: null, produtoId: null, descricao: "", quantidade: 1, valorUnitario: 0, valorManual: false })} data-acao="linha-livre">Linha livre</Button>
          )}
          {edicao && <FormItem edicao={edicao} setEdicao={setEdicao} total={totalEdicao} salvar={salvar} cancelar={() => { setEdicao(null); setModo(null); }} salvando={salvando} clienteId={clienteId} produtos={produtos.itens} buscarAvulso={buscarAvulso} />}
          {!edicao && <div className="flex justify-end"><Button type="button" variant="secondary" size="sm" onClick={() => setModo(null)}><X className="w-4 h-4" /> Fechar</Button></div>}
        </div>
      )}

      {/* Registro fechado: não entra linha nova (o servidor recusa de qualquer jeito) */}
      {fechada && podeEditar && !modo && !edicao && (
        <p className="flex items-center gap-2 text-sm text-ink-muted bg-surface-page border border-surface-border rounded-lg px-3 py-2.5" data-itens-travados>
          <Lock className="w-4 h-4 shrink-0" aria-hidden /> {fechada}
        </p>
      )}
      {!fechada && podeEditar && !modo && !edicao && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setModo("servico")} className="flex-1 justify-center border-dashed" data-acao="novo-servico"><Wrench className="w-4 h-4" /> Serviço do catálogo</Button>
          <Button type="button" variant="secondary" onClick={() => setModo("produto")} className="flex-1 justify-center border-dashed" data-acao="novo-produto"><Package className="w-4 h-4" /> Produto do catálogo</Button>
          <Button type="button" variant="secondary" onClick={() => setEdicao({ tipo: "SERVICO", servicoId: null, produtoId: null, descricao: "", quantidade: 1, valorUnitario: 0, valorManual: false })} className="flex-1 justify-center border-dashed" data-acao="novo-livre"><Plus className="w-4 h-4" /> Linha livre</Button>
        </div>
      )}
    </div>
  );
}

function FormItem({ edicao: e, setEdicao, total, salvar, cancelar, salvando, clienteId, produtos, buscarAvulso }: {
  edicao: Edicao; setEdicao: (f: (e: Edicao | null) => Edicao | null) => void; total: number; salvar: () => void; cancelar: () => void; salvando: boolean;
  clienteId: string | null; produtos: ItemCadastro[]; buscarAvulso: (produtoId: string) => Promise<{ material?: MaterialOrcamento; erro?: string }>;
}) {
  const comMateriais = !!e.materiais?.length;
  const patch = (p: Partial<Edicao>) => setEdicao((atual) => (atual ? { ...atual, ...p } : atual));
  return (
    <div className="space-y-3 px-3 py-3 bg-white border-t border-surface-border" data-form-item>
      {/* USO: o que se muda aqui vale só nesta OS — o serviço e o produto do catálogo ficam como estão */}
      <FaixaDaEdicao escopo="uso" rotulo={e.id ? rotuloDaEdicao("uso", ALVO_LINHA) : "Novo item da OS"} />
      <FormGrid cols={3}>
        <FormField label="Descrição" required className="sm:col-span-3">
          <Input value={e.descricao} onChange={(ev) => patch({ descricao: ev.target.value })} placeholder="Item ou serviço" data-descricao-item />
        </FormField>
        <FormField label="Quantidade"><CampoNumero valor={e.quantidade} onValor={(q) => patch({ quantidade: q })} data-quantidade-item className="!bg-white !border-surface-border !py-2" /></FormField>
        <FormField label={comMateriais ? "Unit. base (R$)" : "Valor unitário (R$)"} dica={comMateriais ? "Preço antes dos materiais. O total = base + materiais inclusos (digite o total para fixar um valor manual)." : undefined}>
          <CampoNumero valor={e.valorUnitario} casas={2} onValor={(u) => patch({ valorUnitario: u })} data-unitario-item className="!bg-white !border-surface-border !py-2" />
        </FormField>
        <FormField label="Total (R$)">
          {comMateriais ? (
            <CampoNumero valor={total} casas={2} onValor={(t) => patch({ valorTotal: t, valorManual: true })} data-total-item-edicao className="!bg-white !border-surface-border !py-2 font-semibold" title="Digitar aqui fixa um valor manual" />
          ) : (
            <p className="text-sm font-medium text-ink py-2 tabular-nums" data-total-item-edicao>{formatarMoeda(total)}</p>
          )}
        </FormField>
      </FormGrid>
      {e.tipo === "SERVICO" && (e.materiais ? (
        <MateriaisLinha item={e} clienteId={clienteId} catalogoProdutos={produtos} onChange={(p) => patch(p as Partial<Edicao>)} buscarAvulso={buscarAvulso} />
      ) : (
        <button type="button" onClick={() => patch({ materiais: [] })} className="text-[11px] font-medium text-primary-600 hover:text-primary-700" data-adicionar-materiais>+ Materiais e peças</button>
      ))}
      {e.origemPreco === "contrato" && <p className="text-[11px] text-ok-texto">Preço da tabela do cliente.</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar} data-acao="salvar-item"><Check className="w-4 h-4" /> Salvar</Button>
      </div>
    </div>
  );
}
