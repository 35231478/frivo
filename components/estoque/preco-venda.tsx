"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatarPct, lerNumero, margemSobreVenda, markupSobreCusto, precoPorMargem } from "@/lib/estoque/preco";

const moeda = (n: number | null | undefined, max = 2) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: max });
const numeroBr = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function Valor({ rotulo, valor, sub, attr, destaque }: { rotulo: string; valor: string; sub: string; attr: string; destaque?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", destaque ? "border-primary-200 bg-primary-50/60" : "border-surface-border bg-white")}>
      <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">{rotulo}</p>
      <p className={cn("text-lg font-bold tabular-nums", destaque ? "text-primary-700" : "text-ink")} {...{ [attr]: "" }}>{valor}</p>
      <p className="text-[11px] text-ink-muted">{sub}</p>
    </div>
  );
}

export interface PrecoVendaProps {
  produtoId: string;
  unidade: string;
  /** custo por unidade do produto: o último de compra, ou o desta nota (na conciliação) */
  custo: number | null;
  rotuloCusto?: string;
  preco: number | null;
  margemVenda: number | null;
  podeEditar: boolean;
  className?: string;
}

/**
 * Preço de venda do produto: por MARGEM sobre a venda (preço = custo ÷ (1 − margem)) ou por preço
 * FIXO. Abre mostrando o preço ATUAL (e a margem/markup que ele dá com o custo de agora); ao mexer,
 * mostra ao vivo a SIMULAÇÃO — custo · preço · margem % (sobre a venda) · markup % (sobre o custo) —
 * marcada como "ainda não salvo". Só grava quando a pessoa clica em salvar: o custo mudar nunca muda
 * o preço sozinho.
 */
export function PrecoVenda({ produtoId, unidade, custo, rotuloCusto = "Último custo de compra", preco, margemVenda, podeEditar, className }: PrecoVendaProps) {
  const router = useRouter();
  const semCusto = custo == null || !(custo > 0);
  const [salvo, setSalvo] = useState({ preco, margemVenda });
  const [modo, setModo] = useState<"margem" | "preco">(margemVenda != null && !semCusto ? "margem" : "preco");
  const [margemTxt, setMargemTxt] = useState(margemVenda != null ? numeroBr(margemVenda) : "");
  const [precoTxt, setPrecoTxt] = useState(preco != null ? numeroBr(preco) : "");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  // até a pessoa mexer, os cartões mostram o preço SALVO (não uma simulação)
  const [editado, setEditado] = useState(false);
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
  const mudou = editado && precoNovo != null && (precoNovo !== salvo.preco || (modo === "margem" ? margemDigitada : null) !== salvo.margemVenda);

  async function salvar() {
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

  return (
    <div className={cn("space-y-3", className)} data-preco-venda={produtoId}>
      <p className={cn("text-[11px] font-semibold uppercase tracking-wider", simulando ? "text-amber-700" : "text-ink-muted")} data-situacao-preco={simulando ? "simulacao" : "atual"}>
        {simulando ? "Simulação — ainda não salvo" : "Preço atual"}
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Valor rotulo="Custo" valor={moeda(custo, 4)} sub={semCusto ? "sem compra com custo ainda" : `${rotuloCusto} · por ${unidade}`} attr="data-custo" />
        <Valor rotulo="Preço" valor={moeda(precoExibido)} sub={`de venda · por ${unidade}`} attr="data-preco" destaque />
        <Valor rotulo="Margem" valor={formatarPct(margem)} sub="sobre a venda" attr="data-margem" />
        <Valor rotulo="Markup" valor={formatarPct(markup)} sub="sobre o custo" attr="data-markup" />
      </div>

      {podeEditar ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg border border-surface-border p-0.5 bg-surface-alt" role="radiogroup" aria-label="Definir o preço por">
            {(["margem", "preco"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={modo === m} data-modo={m}
                disabled={m === "margem" && semCusto} title={m === "margem" && semCusto ? "Sem custo de compra não dá para calcular pela margem" : undefined}
                onClick={() => { setModo(m); mexer(); if (m === "preco" && precoNovo != null && !precoTxt) setPrecoTxt(numeroBr(precoNovo)); }}
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
          <Button type="button" onClick={salvar} loading={enviando} disabled={enviando || !mudou || !!erroMargem} data-salvar-preco><Tag className="w-4 h-4" /> Salvar preço</Button>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Para mudar o preço, precisa de Configurações › gerenciar (o mesmo do cadastro de produtos).</p>
      )}
      {erroMargem && <p className="text-xs text-red-600" role="alert">{erroMargem}</p>}
      {podeEditar && precoDaMargemAlvo != null && salvo.preco != null && Math.abs(precoDaMargemAlvo - salvo.preco) >= 0.01 && (
        <p className="text-xs text-ink-muted" data-sugestao-margem-alvo>
          Com a margem alvo de {formatarPct(salvo.margemVenda)} e este custo, o preço seria <strong className="text-ink">{moeda(precoDaMargemAlvo)}</strong>.{" "}
          <button type="button" className="font-semibold text-primary-600 hover:underline" data-usar-margem-alvo
            onClick={() => { setModo("margem"); setMargemTxt(numeroBr(salvo.margemVenda!)); mexer(); }}>
            Simular com a margem alvo
          </button>
        </p>
      )}
      <p className="text-[11px] text-ink-subtle" data-preco-salvo>
        Preço salvo: <strong className="text-ink-muted">{moeda(salvo.preco)}</strong>
        {salvo.margemVenda != null ? ` · definido por margem de ${formatarPct(salvo.margemVenda)} sobre a venda` : salvo.preco != null ? " · preço fixo" : ""}
        {" · "}Margem = (preço − custo) ÷ preço · Markup = (preço − custo) ÷ custo
      </p>
      {msg && (
        <p role={msg.tipo === "erro" ? "alert" : "status"} className={cn("text-sm font-medium flex items-center gap-1", msg.tipo === "ok" ? "text-success-700" : "text-red-600")}>
          {msg.tipo === "ok" && <CheckCircle2 className="w-4 h-4" />} {msg.texto}
        </p>
      )}
    </div>
  );
}
