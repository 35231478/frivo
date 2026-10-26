"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatarPct, lerNumero, margemSobreVenda, markupSobreCusto, precoPorMargem } from "@/lib/estoque/preco";

const moeda = (n: number | null | undefined, max = 2) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: max });
const numeroBr = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
/** Preço no campo: sempre com centavos ("95,50", não "95,5") */
const precoBr = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Valor({ rotulo, valor, sub, attr, destaque, compacto }: { rotulo: string; valor: string; sub: string; attr: string; destaque?: boolean; compacto?: boolean }) {
  return (
    <div className={cn("rounded-lg border", compacto ? "px-2.5 py-1.5" : "px-3 py-2", destaque ? "border-primary-200 bg-primary-50/60" : "border-surface-border bg-white")}>
      <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">{rotulo}</p>
      <p className={cn("font-bold tabular-nums", compacto ? "text-base" : "text-lg", destaque ? "text-primary-700" : "text-ink")} {...{ [attr]: "" }}>{valor}</p>
      <p className="text-[11px] text-ink-muted">{sub}</p>
    </div>
  );
}

/** Preço pedido na tela: por margem (o preço sai do custo) ou fixo. */
export type PrecoDefinido = { modo: "margem"; margem: number } | { modo: "preco"; preco: number };

export interface PrecoVendaProps {
  /** produto do cadastro (vazio = produto novo da nota, que ainda vai ser criado) */
  produtoId?: string | null;
  unidade: string;
  /** custo por unidade do produto: o último de compra, ou o desta nota (na conciliação) */
  custo: number | null;
  rotuloCusto?: string;
  preco: number | null;
  margemVenda: number | null;
  podeEditar: boolean;
  className?: string;
  /** Mais enxuto (linha da conciliação) */
  compacto?: boolean;
  /**
   * RASCUNHO (central de lançamento da nota): sem botão de salvar — o que for definido aqui vai para o
   * produto só ao "Confirmar e lançar". `valor` = o que já está no rascunho; `onChange` recebe o preço
   * definido, null (manter o preço atual) ou "invalido".
   */
  rascunho?: { valor: PrecoDefinido | null; onChange: (v: PrecoDefinido | null | "invalido") => void };
}

/**
 * Preço de venda do produto: por MARGEM sobre a venda (preço = custo ÷ (1 − margem)) ou por preço
 * FIXO. Abre mostrando o preço ATUAL (e a margem/markup que ele dá com o custo de agora); ao mexer,
 * mostra ao vivo a SIMULAÇÃO — custo · preço · margem % (sobre a venda) · markup % (sobre o custo) —
 * marcada como "ainda não salvo". Só grava quando a pessoa clica em salvar (ou, no rascunho da nota,
 * ao lançar): o custo mudar nunca muda o preço sozinho.
 */
export function PrecoVenda({ produtoId, unidade, custo, rotuloCusto = "Último custo de compra", preco, margemVenda, podeEditar, className, compacto, rascunho }: PrecoVendaProps) {
  const router = useRouter();
  const semCusto = custo == null || !(custo > 0);
  const inicial = rascunho?.valor ?? null;
  const [salvo, setSalvo] = useState({ preco, margemVenda });
  const [modo, setModo] = useState<"margem" | "preco">(inicial ? inicial.modo : margemVenda != null && !semCusto ? "margem" : "preco");
  const [margemTxt, setMargemTxt] = useState(inicial?.modo === "margem" ? numeroBr(inicial.margem) : margemVenda != null ? numeroBr(margemVenda) : "");
  const [precoTxt, setPrecoTxt] = useState(inicial?.modo === "preco" ? precoBr(inicial.preco) : preco != null ? precoBr(preco) : "");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  // até a pessoa mexer, os cartões mostram o preço SALVO (não uma simulação)
  const [editado, setEditado] = useState(!!inicial);
  const mexer = () => { setEditado(true); setMsg(null); };

  const margemDigitada = lerNumero(margemTxt);
  const precoNovo = modo === "margem" ? precoPorMargem(custo, margemDigitada) : lerNumero(precoTxt);
  const precoExibido = editado ? precoNovo : salvo.preco;
  const simulando = editado && precoNovo !== salvo.preco;
  const margem = margemSobreVenda(precoExibido, custo);
  const markup = markupSobreCusto(precoExibido, custo);
  // margem alvo guardada e o custo mudou: o preço que a manteria (só sugestão, com botão)
  const precoDaMargemAlvo = !editado && salvo.margemVenda != null ? precoPorMargem(custo, salvo.margemVenda) : null;
  const erroMargem = modo === "margem" && margemTxt.trim() !== "" && precoNovo == null
    ? (margemDigitada != null && margemDigitada >= 100 ? "A margem sobre a venda precisa ser menor que 100%." : "Margem inválida.") : null;
  const erroPreco = modo === "preco" && precoTxt.trim() !== "" && !(precoNovo != null && precoNovo > 0) ? "Preço inválido." : null;
  const mudou = editado && precoNovo != null && (precoNovo !== salvo.preco || (modo === "margem" ? margemDigitada : null) !== salvo.margemVenda);

  // Rascunho: avisa o pai a cada mudança da pessoa (o callback mais recente fica num ref: sem laço de render)
  const aoMudar = useRef(rascunho?.onChange);
  aoMudar.current = rascunho?.onChange;
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    if (!aoMudar.current) return;
    if (!editado) { aoMudar.current(null); return; }
    if (erroMargem || erroPreco) { aoMudar.current("invalido"); return; }
    if (!mudou || precoNovo == null) { aoMudar.current(null); return; }
    aoMudar.current(modo === "margem" ? { modo, margem: margemDigitada! } : { modo, preco: precoNovo });
  }, [editado, modo, margemTxt, precoTxt]); // eslint-disable-line react-hooks/exhaustive-deps

  function voltarAoAtual() {
    setEditado(false); setMsg(null);
    setModo(salvo.margemVenda != null && !semCusto ? "margem" : "preco");
    setMargemTxt(salvo.margemVenda != null ? numeroBr(salvo.margemVenda) : "");
    setPrecoTxt(salvo.preco != null ? precoBr(salvo.preco) : "");
  }

  async function salvar() {
    if (!produtoId) return;
    if (precoNovo == null || !(precoNovo > 0)) { setMsg({ tipo: "erro", texto: "Informe uma margem ou um preço válido." }); return; }
    setEnviando(true); setMsg(null);
    try {
      const corpo = modo === "margem" ? { modo, margem: margemDigitada, custoBase: custo } : { modo, preco: precoNovo };
      const r = await fetch(`/api/estoque/${produtoId}/preco`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: j.erro ?? "Não foi possível salvar o preço." }); return; }
      setSalvo({ preco: j.preco, margemVenda: j.margemVenda });
      setEditado(false);
      setMsg({ tipo: "ok", texto: `Preço salvo: ${moeda(j.preco)}.` });
      router.refresh();
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    } finally { setEnviando(false); }
  }

  const situacao = simulando ? (rascunho ? "rascunho" : "simulacao") : "atual";
  return (
    <div className={cn(compacto ? "space-y-2" : "space-y-3", className)} data-preco-venda={produtoId ?? "novo"}>
      <p className={cn("text-[11px] font-semibold uppercase tracking-wider", simulando ? "text-atencao-texto" : "text-ink-muted")} data-situacao-preco={situacao}>
        {!simulando ? (produtoId ? "Preço atual" : "Produto novo — sem preço ainda") : rascunho ? "Novo preço — vai para o produto ao confirmar e lançar" : "Simulação — ainda não salvo"}
      </p>
      <div className={cn("grid gap-2", compacto ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 lg:grid-cols-4")}>
        <Valor compacto={compacto} rotulo="Custo" valor={moeda(custo, 4)} sub={semCusto ? "sem compra com custo ainda" : `${rotuloCusto} · por ${unidade}`} attr="data-custo" />
        <Valor compacto={compacto} rotulo="Preço" valor={moeda(precoExibido)} sub={`de venda · por ${unidade}`} attr="data-preco" destaque />
        <Valor compacto={compacto} rotulo="Margem" valor={formatarPct(margem)} sub="sobre a venda" attr="data-margem" />
        <Valor compacto={compacto} rotulo="Markup" valor={formatarPct(markup)} sub="sobre o custo" attr="data-markup" />
      </div>

      {podeEditar ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg border border-surface-border p-0.5 bg-surface-alt" role="radiogroup" aria-label="Definir o preço por">
            {(["margem", "preco"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={modo === m} data-modo={m}
                disabled={m === "margem" && semCusto} title={m === "margem" && semCusto ? "Sem custo de compra não dá para calcular pela margem" : undefined}
                onClick={() => { setModo(m); mexer(); if (m === "preco" && precoNovo != null && !precoTxt) setPrecoTxt(precoBr(precoNovo)); }}
                className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-colors disabled:opacity-40", modo === m ? "bg-white text-primary-700 shadow-sm" : "text-ink-muted hover:text-ink")}>
                {m === "margem" ? "Por margem" : "Preço fixo"}
              </button>
            ))}
          </div>
          {modo === "margem" ? (
            <label className="block">
              <span className="text-xs font-semibold text-ink">Margem sobre a venda</span>
              <div className="relative mt-1 w-32">
                <Input value={margemTxt} onChange={(e) => { setMargemTxt(e.target.value); mexer(); }} inputMode="decimal" className="pr-7 text-right" aria-label="Margem sobre a venda (%)" name="margem" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">%</span>
              </div>
            </label>
          ) : (
            <label className="block">
              <span className="text-xs font-semibold text-ink">Preço de venda</span>
              <div className="relative mt-1 w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">R$</span>
                <Input value={precoTxt} onChange={(e) => { setPrecoTxt(e.target.value); mexer(); }} inputMode="decimal" className="pl-9 text-right" aria-label="Preço de venda (R$)" name="preco" />
              </div>
            </label>
          )}
          {rascunho ? (
            editado && (
              <button type="button" onClick={voltarAoAtual} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink pb-2.5" data-manter-preco>
                <RotateCcw className="w-3.5 h-3.5" /> {produtoId ? "Manter o preço atual" : "Sem preço por enquanto"}
              </button>
            )
          ) : (
            <Button type="button" onClick={salvar} loading={enviando} disabled={enviando || !mudou || !!erroMargem} data-salvar-preco><Tag className="w-4 h-4" /> Salvar preço</Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Para mudar o preço, precisa de Configurações › gerenciar (o mesmo do cadastro de produtos).</p>
      )}
      {(erroMargem || erroPreco) && <p className="text-xs text-atrasado" role="alert">{erroMargem ?? erroPreco}</p>}
      {podeEditar && precoDaMargemAlvo != null && salvo.preco != null && Math.abs(precoDaMargemAlvo - salvo.preco) >= 0.01 && (
        <p className="text-xs text-ink-muted" data-sugestao-margem-alvo>
          Com a margem alvo de {formatarPct(salvo.margemVenda)} e este custo, o preço seria <strong className="text-ink">{moeda(precoDaMargemAlvo)}</strong>.{" "}
          <button type="button" className="font-semibold text-primary-600 hover:underline" data-usar-margem-alvo
            onClick={() => { setModo("margem"); setMargemTxt(numeroBr(salvo.margemVenda!)); mexer(); }}>
            Simular com a margem alvo
          </button>
        </p>
      )}
      {produtoId && (
        <p className="text-[11px] text-ink-subtle" data-preco-salvo>
          {rascunho ? "Preço do produto hoje" : "Preço salvo"}: <strong className="text-ink-muted">{moeda(salvo.preco)}</strong>
          {salvo.margemVenda != null ? ` · definido por margem de ${formatarPct(salvo.margemVenda)} sobre a venda` : salvo.preco != null ? " · preço fixo" : ""}
          {!compacto && <>{" · "}Margem = (preço − custo) ÷ preço · Markup = (preço − custo) ÷ custo</>}
        </p>
      )}
      {msg && (
        <p role={msg.tipo === "erro" ? "alert" : "status"} className={cn("text-sm font-medium flex items-center gap-1", msg.tipo === "ok" ? "text-success-700" : "text-atrasado")}>
          {msg.tipo === "ok" && <CheckCircle2 className="w-4 h-4" />} {msg.texto}
        </p>
      )}
    </div>
  );
}
