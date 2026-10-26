"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightLeft, Check, Link2, Loader2, PackagePlus, Save, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatarMoeda } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";
import { avisoCusto, converterItem, formatarFator, lerNumero, mesmaUnidade } from "@/lib/estoque/preco";
import { formatarNcm } from "@/lib/compras/rotulos";
import { PrecoVenda, type PrecoDefinido } from "@/components/estoque/preco-venda";
import { corpoFinanceiro, FinanceiroNotaEditor, financeiroInicial, type FinanceiroNota, type FinanceiroUi } from "@/components/compras/financeiro-nota";

export interface FiscalProduto { ncm: string | null; cest: string | null; gtin: string | null; origemMercadoria: string | null; unidadeTributavel: string | null }
export interface ProdutoConciliacao {
  id: string; nome: string; unidade: string; saldo?: number;
  /** preço de venda atual, margem alvo e último custo de compra (por unidade do produto) */
  preco: number | null; margemVenda: number | null; custo: number | null;
  fiscal: FiscalProduto;
}
export interface ItemConciliacao {
  id: string; numeroItem: number; codigoFornecedor: string; descricaoFornecedor: string;
  unidade: string; quantidade: number; valorUnitario: number; valorTotal: number;
  fiscal: FiscalProduto;
  /** fator salvo no item: 1 [unidade da nota] = fator [unidade do produto] */
  fator: number;
  /** o que o de-para deste fornecedor aprendeu para este código */
  fatorAprendido: { unidade: string | null; fator: number } | null;
  produto: ProdutoConciliacao | null;
  /** veio vinculado pelo de-para (aprendido de nota anterior deste fornecedor) */
  aprendido: boolean;
  /** preço de venda já definido nesta nota (rascunho salvo), aplicado ao produto só ao lançar */
  precoRascunho?: PrecoDefinido | null;
}
type Escolha = { modo: "existente"; produto: ProdutoConciliacao } | { modo: "novo"; nome: string; unidade: string } | null;
type PrecoTela = PrecoDefinido | null | "invalido";

const moeda4 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const unidadeDoProduto = (i: ItemConciliacao, e: Escolha) => (e?.modo === "existente" ? e.produto.unidade : e?.modo === "novo" ? (e.unidade.trim() || i.unidade) : null);
const CAMPOS_FISCAIS = [["ncm", "NCM"], ["cest", "CEST"], ["gtin", "GTIN"], ["origemMercadoria", "origem"], ["unidadeTributavel", "un. trib."]] as const;

/** Fator para começar: mesma unidade = 1; o salvo/aprendido se houver; senão vazio (a pessoa informa). */
function fatorInicial(i: ItemConciliacao): string {
  if (!i.produto) return "";
  if (mesmaUnidade(i.unidade, i.produto.unidade)) return "1";
  const aprendidoValido = i.fatorAprendido && (i.fatorAprendido.unidade == null || mesmaUnidade(i.fatorAprendido.unidade, i.unidade));
  return i.fator !== 1 || aprendidoValido ? formatarFator(i.fator) : "";
}
/** Fator em uso: mesma unidade = 1; senão o digitado (null = falta ou inválido) */
function fatorEfetivo(i: ItemConciliacao, e: Escolha, txt: string): number | null {
  const un = unidadeDoProduto(i, e);
  if (un == null) return null;
  if (mesmaUnidade(i.unidade, un)) return 1;
  const f = lerNumero(txt);
  return f != null && f > 0 ? f : null;
}

/**
 * Central de lançamento da nota de compra (rascunho até "Confirmar e lançar"):
 *  - itens: cada um → produto existente (busca) OU produto novo (nome e unidade editáveis na linha);
 *    o que o fornecedor já mandou antes chega vinculado ("aprendido"), com o fator de conversão;
 *    unidade diferente = "1 [unidade da nota] = ___ [unidade do produto]";
 *  - preço de venda NA LINHA (custo · preço · margem · markup, ao vivo): definido aqui, vai para o produto
 *    só ao lançar; custo diferente da compra anterior: só AVISA;
 *  - financeiro: categoria e centro de custo (padrão do fornecedor), forma de pagamento (do XML) e as
 *    parcelas editáveis, com o boleto de cada uma.
 * "Salvar rascunho" grava tudo sem lançar; "Confirmar e lançar" faz tudo numa transação.
 */
export function ConciliacaoNota({ notaId, itens, pedidos, podeLancar, motivoSemLancar, financeiro, podePrecificar = false }: {
  notaId: string; itens: ItemConciliacao[]; pedidos: { id: string; numero: string }[];
  /** Financeiro › fluxo de caixa: lança e mexe no financeiro */
  podeLancar: boolean; motivoSemLancar?: string | null;
  financeiro: FinanceiroNota;
  /** Configurações › gerenciar (cadastro de produtos): define o preço de venda na linha */
  podePrecificar?: boolean;
}) {
  const router = useRouter();
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>(() =>
    Object.fromEntries(itens.map((i) => [i.id, i.produto ? { modo: "existente", produto: i.produto } : null])));
  const [fatores, setFatores] = useState<Record<string, string>>(() => Object.fromEntries(itens.map((i) => [i.id, fatorInicial(i)])));
  const [precos, setPrecos] = useState<Record<string, PrecoTela>>(() => Object.fromEntries(itens.map((i) => [i.id, i.precoRascunho ?? null])));
  const [fin, setFin] = useState<FinanceiroUi>(() => financeiroInicial(financeiro));
  const [pedidoId, setPedidoId] = useState("");
  const [enviando, setEnviando] = useState<"salvar" | "lancar" | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const definir = (i: ItemConciliacao, e: Escolha) => {
    const antes = escolhas[i.id];
    setEscolhas((s) => ({ ...s, [i.id]: e }));
    const un = unidadeDoProduto(i, e);
    // editar o nome do produto novo (mesma unidade) não é trocar de produto: fator e preço ficam
    const mesmoProduto = (antes?.modo === "existente" && e?.modo === "existente" && antes.produto.id === e.produto.id) || (antes?.modo === "novo" && e?.modo === "novo");
    // trocou o produto (ou a unidade): fator volta para 1 (mesma unidade) ou fica em branco para informar
    if (!mesmoProduto || unidadeDoProduto(i, antes) !== un)
      setFatores((f) => ({ ...f, [i.id]: un != null && mesmaUnidade(i.unidade, un) ? "1" : e?.modo === "existente" && e.produto.id === i.produto?.id ? fatorInicial(i) : "" }));
    // o preço definido era para o produto anterior: começa de novo
    if (!mesmoProduto) setPrecos((p) => ({ ...p, [i.id]: null }));
    setMsg(null);
  };
  const completo = (i: ItemConciliacao) => {
    const e = escolhas[i.id];
    return !!e && (e.modo === "existente" || e.nome.trim().length >= 2) && fatorEfetivo(i, e, fatores[i.id] ?? "") != null;
  };
  const vinculados = itens.filter(completo).length;
  type CorpoItem = ({ itemId: string; produtoId: string } | { itemId: string; novo: { nome: string; unidade: string | null } }) & { fator?: number; preco?: PrecoDefinido | null };
  const corpoItens = () => itens.flatMap((i): CorpoItem[] => {
    const e = escolhas[i.id];
    if (!e) return [];
    const fator = fatorEfetivo(i, e, fatores[i.id] ?? "") ?? undefined;
    // preço só vai no corpo de quem pode precificar (sem o campo, o servidor não mexe)
    const preco = podePrecificar ? { preco: precos[i.id] === "invalido" ? null : (precos[i.id] as PrecoDefinido | null) } : {};
    return e.modo === "existente"
      ? [{ itemId: i.id, produtoId: e.produto.id, fator, ...preco }]
      : [{ itemId: i.id, novo: { nome: e.nome.trim(), unidade: e.unidade.trim() || null }, fator, ...preco }];
  });

  async function enviar(acao: "salvar" | "lancar") {
    setMsg(null);
    const invalido = itens.find((i) => precos[i.id] === "invalido" && escolhas[i.id]);
    if (invalido && podePrecificar) { setMsg({ tipo: "erro", texto: `Item ${invalido.numeroItem}: preço de venda inválido — corrija ou mantenha o preço atual.` }); return; }
    const novoSemNome = itens.find((i) => { const e = escolhas[i.id]; return e?.modo === "novo" && e.nome.trim().length < 2; });
    if (novoSemNome) { setMsg({ tipo: "erro", texto: `Item ${novoSemNome.numeroItem}: dê um nome ao produto novo.` }); return; }
    let corpoFin: Record<string, unknown> | undefined;
    if (podeLancar) {
      const f = corpoFinanceiro(fin, financeiro);
      if (!f.ok) { setMsg({ tipo: "erro", texto: f.erro }); return; }
      corpoFin = f.corpo;
    }
    setEnviando(acao);
    try {
      const corpo = { itens: corpoItens(), ...(corpoFin && { financeiro: corpoFin }), ...(acao === "lancar" && { pedidoCompraId: pedidoId || null }) };
      const r = await fetch(acao === "salvar" ? `/api/compras/notas/${notaId}/conciliacao` : `/api/compras/notas/${notaId}/lancar`, {
        method: acao === "salvar" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: j.erro ?? "Não foi possível concluir." }); return; }
      setMsg({ tipo: "ok", texto: acao === "salvar" ? (j.faltam ? `Rascunho salvo. Faltam ${j.faltam} item(ns) sem produto.` : "Rascunho salvo: tudo pronto para lançar.") : "Nota lançada." });
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
          <p className="text-sm font-semibold text-ink">Itens da nota <span className="text-ink-muted font-normal">· <span data-vinculados>{vinculados}</span> de {itens.length} com produto</span></p>
          {semVinculo.length > 0 && (
            <button type="button" className="text-xs font-semibold text-primary-600 hover:underline" data-criar-todos
              onClick={() => semVinculo.forEach((i) => definir(i, { modo: "novo", nome: i.descricaoFornecedor, unidade: i.unidade }))}>
              {semVinculo.length === 1 ? "Criar produto novo para o item sem vínculo" : `Criar produto novo para os ${semVinculo.length} sem vínculo`}
            </button>
          )}
        </div>
        <ul className="divide-y divide-surface-border">
          {itens.map((i) => (
            <li key={i.id} data-item={i.numeroItem} className="px-4 py-3 space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-ink-muted">Item {i.numeroItem} · cód. <span className="font-mono">{i.codigoFornecedor}</span>{i.fiscal.ncm && ` · NCM ${formatarNcm(i.fiscal.ncm)}`}</p>
                  <p className="text-sm font-semibold text-ink">{i.descricaoFornecedor}</p>
                  <p className="text-xs text-ink-muted mt-0.5 tabular-nums">{formatarQtd(i.quantidade)} {i.unidade} × {moeda4(i.valorUnitario)} = <span className="font-semibold text-ink">{formatarMoeda(i.valorTotal)}</span></p>
                </div>
                <Vinculo item={i} escolha={escolhas[i.id]} onChange={(e) => definir(i, e)} />
              </div>
              {escolhas[i.id] && (
                <Linha item={i} escolha={escolhas[i.id]} fatorTxt={fatores[i.id] ?? ""} podePrecificar={podePrecificar}
                  preco={precos[i.id]} onPreco={(v) => { setPrecos((p) => ({ ...p, [i.id]: v })); setMsg(null); }}
                  onFator={(t) => { setFatores((f) => ({ ...f, [i.id]: t })); setMsg(null); }} />
              )}
            </li>
          ))}
        </ul>
      </div>

      <FinanceiroNotaEditor nota={financeiro} valor={fin} onChange={(v) => { setFin(v); setMsg(null); }} podeEditar={podeLancar} />

      {pedidos.length > 0 && (
        <div className="card p-4">
          <label className="block text-sm max-w-md">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">Pedido de compra (opcional)</span>
            <select value={pedidoId} onChange={(e) => setPedidoId(e.target.value)} data-pedido
              className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm">
              <option value="">Sem pedido</option>
              {pedidos.map((p) => <option key={p.id} value={p.id}>{p.numero}</option>)}
            </select>
            <span className="text-xs text-ink-muted">O custo real da nota vai para os itens do pedido com o mesmo produto.</span>
          </label>
        </div>
      )}

      {msg && <p role={msg.tipo === "erro" ? "alert" : "status"} className={cn("text-sm font-medium", msg.tipo === "ok" ? "text-success-700" : "text-atrasado")}>{msg.texto}</p>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2">
        {!podeLancar && motivoSemLancar && <p className="text-xs text-ink-muted sm:mr-auto" data-sem-lancar>{motivoSemLancar}</p>}
        {podeLancar && <p className="text-xs text-ink-muted sm:mr-auto">Nada vai para o estoque nem para o financeiro antes de confirmar: até lá, é rascunho.</p>}
        <Button type="button" variant="secondary" onClick={() => enviar("salvar")} loading={enviando === "salvar"} disabled={!!enviando} data-salvar-rascunho>
          <Save className="w-4 h-4" /> Salvar rascunho
        </Button>
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
      <div className="flex items-center gap-2 rounded-lg border border-success-200 bg-success-50/60 px-3 py-2 self-start" data-vinculo="existente">
        <Link2 className="w-4 h-4 text-success-700 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink truncate">{escolha.produto.nome}</p>
          <p className="text-[11px] text-ink-muted">unidade {escolha.produto.unidade}{aprendido && <span className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-primary-700" data-aprendido><Sparkles className="w-3 h-3" /> aprendido de nota anterior</span>}</p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-xs font-medium text-ink-muted hover:text-ink" aria-label="Trocar produto">Trocar</button>
      </div>
    );
  }
  if (escolha?.modo === "novo") {
    return (
      <div className="rounded-lg border border-primary-200 bg-primary-50/50 px-3 py-2 space-y-2 self-start" data-vinculo="novo">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-primary-700 flex items-center gap-1"><PackagePlus className="w-3.5 h-3.5" /> Produto novo — confira o nome</p>
          <button type="button" onClick={() => onChange(null)} className="text-ink-muted hover:text-ink" aria-label="Cancelar produto novo"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-[1fr_5.5rem] gap-2">
          <label className="block">
            <span className="text-[11px] font-semibold text-ink">Nome do produto</span>
            <Input value={escolha.nome} onChange={(e) => onChange({ ...escolha, nome: e.target.value })} aria-label="Nome do produto novo" name={`novo-nome-${item.numeroItem}`}
              maxLength={200} data-novo-nome={item.numeroItem} className={cn("mt-0.5", escolha.nome.trim().length < 2 && "border-atrasado")} />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-ink">Unidade</span>
            <Input value={escolha.unidade} onChange={(e) => onChange({ ...escolha, unidade: e.target.value })} aria-label="Unidade" name={`novo-un-${item.numeroItem}`} maxLength={10} className="mt-0.5" />
          </label>
        </div>
        {escolha.nome.trim().length < 2 && <p className="text-[11px] text-atrasado">Dê um nome ao produto novo.</p>}
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

/**
 * O resto da linha do item vinculado: conversão "1 UN = ___ kg" (aprendida ou a informar), o que entra e
 * a que custo, aviso de custo diferente da última compra, o PREÇO DE VENDA (custo · preço · margem ·
 * markup ao vivo, definido aqui e aplicado ao lançar) e os dados fiscais.
 */
function Linha({ item, escolha, fatorTxt, onFator, podePrecificar, preco, onPreco }: {
  item: ItemConciliacao; escolha: Escolha; fatorTxt: string; onFator: (t: string) => void; podePrecificar: boolean;
  preco: PrecoTela | undefined; onPreco: (v: PrecoTela) => void;
}) {
  const un = unidadeDoProduto(item, escolha)!;
  const igual = mesmaUnidade(item.unidade, un);
  const fator = fatorEfetivo(item, escolha, fatorTxt);
  const conv = fator ? converterItem(item.quantidade, item.valorUnitario, fator) : null;
  const produto = escolha?.modo === "existente" ? escolha.produto : null;
  const aprendido = !igual && item.fatorAprendido && produto?.id === item.produto?.id
    && (item.fatorAprendido.unidade == null || mesmaUnidade(item.fatorAprendido.unidade, item.unidade)) && lerNumero(fatorTxt) === item.fatorAprendido.fator;
  const unidadeMudou = !igual && item.fatorAprendido?.unidade && produto?.id === item.produto?.id && !mesmaUnidade(item.fatorAprendido.unidade, item.unidade)
    ? item.fatorAprendido : null;
  // preço novo definido na linha: o aviso de custo (sobre o preço antigo) dá lugar à decisão da pessoa
  const definido = preco != null && preco !== "invalido";
  const aviso = produto && conv && !definido ? avisoCusto({
    produtoId: produto.id, produto: produto.nome, unidade: un, custoAnterior: produto.custo, custoNovo: conv.custoUnitario, preco: produto.preco, margemAlvo: produto.margemVenda,
  }) : null;
  const divergencias = produto ? CAMPOS_FISCAIS.flatMap(([c, rot]) => {
    const daNota = item.fiscal[c];
    const doCadastro = produto.fiscal[c];
    return daNota && doCadastro && daNota.trim() !== doCadastro.trim() ? [`${rot}: cadastro ${doCadastro} · nota ${daNota}`] : [];
  }) : [];

  return (
    <div className="rounded-lg bg-surface-alt/50 border border-surface-border px-3 py-2.5 space-y-2.5 text-xs" data-conversao={item.numeroItem}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-ink">
          <ArrowRightLeft className="w-3.5 h-3.5 text-primary-600" />
          1 {item.unidade} =
          <Input value={igual ? "1" : fatorTxt} onChange={(e) => onFator(e.target.value)} disabled={igual} inputMode="decimal"
            className={cn("h-8 w-24 text-right text-sm", !igual && fator == null && "border-atencao")} aria-label={`Quantos ${un} vêm em 1 ${item.unidade} (item ${item.numeroItem})`} data-fator-item={item.numeroItem} />
          {un}
        </span>
        {aprendido && <span className="inline-flex items-center gap-0.5 font-semibold text-primary-700" data-fator-aprendido><Sparkles className="w-3 h-3" /> fator aprendido da nota anterior</span>}
        {conv ? (
          <span className="text-ink-muted tabular-nums" data-entra>Entra <strong className="text-ink">{formatarQtd(conv.quantidade)} {un}</strong> · custo <strong className="text-ink">{moeda4(conv.custoUnitario)}/{un}</strong></span>
        ) : (
          <span className="text-atencao-texto font-medium" data-falta-fator>Informe quantos {un} vêm em 1 {item.unidade}.</span>
        )}
      </div>
      {unidadeMudou && (
        <p className="text-atencao-texto flex items-start gap-1" data-unidade-mudou><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> Antes este item vinha em “{unidadeMudou.unidade}” (1 {unidadeMudou.unidade} = {formatarFator(unidadeMudou.fator)} {un}); nesta nota veio em “{item.unidade}”. Confira o fator.</p>
      )}
      {aviso && (
        <p className="text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-md px-2.5 py-1.5 flex items-start gap-1.5" data-aviso-custo={item.numeroItem}><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {aviso.texto}</p>
      )}
      {conv && (
        <div data-preco-item={item.numeroItem}>
          <PrecoVenda key={produto?.id ?? "novo"} compacto produtoId={produto?.id ?? null} unidade={un} custo={conv.custoUnitario} rotuloCusto="Custo nesta nota"
            preco={produto?.preco ?? null} margemVenda={produto?.margemVenda ?? null} podeEditar={podePrecificar}
            rascunho={{ valor: preco && preco !== "invalido" ? preco : null, onChange: onPreco }} />
        </div>
      )}
      <Fiscal item={item} divergencias={divergencias} />
    </div>
  );
}

function Fiscal({ item, divergencias }: { item: ItemConciliacao; divergencias: string[] }) {
  const f = item.fiscal;
  const partes = [f.ncm && `NCM ${formatarNcm(f.ncm)}`, f.cest && `CEST ${f.cest}`, f.gtin && `GTIN ${f.gtin}`, f.origemMercadoria && `origem ${f.origemMercadoria}`, f.unidadeTributavel && `un. trib. ${f.unidadeTributavel}`].filter(Boolean);
  if (!partes.length && !divergencias.length) return null;
  return (
    <div className="text-ink-subtle" data-fiscal={item.numeroItem}>
      {partes.length > 0 && <p>Fiscal da nota: {partes.join(" · ")} — vai para o cadastro do produto onde estiver vazio.</p>}
      {divergencias.map((d) => <p key={d} className="text-atencao-texto" data-divergencia-fiscal>{d} (fica o do cadastro)</p>)}
    </div>
  );
}

function BuscaProduto({ onEscolher, rotulo }: { onEscolher: (p: ProdutoConciliacao) => void; rotulo: string }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProdutoConciliacao[]>([]);
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
