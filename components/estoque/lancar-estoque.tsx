"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, PackagePlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";
import { arred, calcularMovimento, formatarDelta, formatarQtd, lancamentoManualSchema, mensagemLancamento } from "@/lib/estoque/regras";

type Op = "ENTRADA" | "AJUSTE" | "INVENTARIO";
const OPS: { id: Op; label: string; dica: string }[] = [
  { id: "ENTRADA", label: "Entrada", dica: "Chegou material: soma ao saldo." },
  { id: "AJUSTE", label: "Ajuste", dica: "Corrige o saldo para o valor certo (motivo obrigatório)." },
  { id: "INVENTARIO", label: "Inventário", dica: "Contagem física: o saldo passa a ser o que foi contado." },
];

export interface ProdutoLancamento { id: string; nome: string; unidade: string; saldo: number }

/** Número digitado ("1.234,5" ou "2,5") → number; vazio/ inválido = null */
function lerNumero(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lançamento manual de estoque (Entrada / Ajuste / Inventário) — só aparece para quem tem
 * "Estoque › gerenciar". Grava pela API (lançamento + saldo juntos) e atualiza a página.
 */
export function LancarEstoque({ produto, compacto = false }: { produto: ProdutoLancamento; compacto?: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [op, setOp] = useState<Op>("ENTRADA");
  const [valor, setValor] = useState("");
  const [custo, setCusto] = useState("");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<{ saldo: number; aviso: string | null } | null>(null);

  const abrir = () => { setOp("ENTRADA"); setValor(""); setCusto(""); setObs(""); setErro(null); setFeito(null); setAberto(true); };
  const fechar = () => setAberto(false);

  const n = lerNumero(valor);
  const previa = n != null && n >= 0 ? calcularMovimento(op, produto.saldo, n) : null;
  const un = produto.unidade;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const corpo = op === "ENTRADA"
      ? { operacao: op, quantidade: valor, ...(custo.trim() && { custoUnitario: custo }), ...(obs.trim() && { observacao: obs }) }
      : op === "AJUSTE" ? { operacao: op, novoSaldo: valor, observacao: obs }
      : { operacao: op, contagem: valor, ...(obs.trim() && { observacao: obs }) };
    const v = lancamentoManualSchema.safeParse(corpo);
    if (!v.success) { setErro(mensagemLancamento(v.error)); return; }
    if (op === "AJUSTE" && previa && previa.delta === 0) { setErro("O saldo já é esse — não há o que ajustar."); return; }
    setErro(null); setEnviando(true);
    try {
      const r = await fetch(`/api/estoque/${produto.id}/movimentacoes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.data),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível lançar."); return; }
      setFeito({ saldo: j.saldo, aviso: j.aviso ?? null });
      router.refresh();
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant={compacto ? "secondary" : "primary"} onClick={abrir} data-lancar={produto.id}>
        <PackagePlus className="w-3.5 h-3.5" /> Lançar
      </Button>
      <Modal aberto={aberto} onFechar={fechar} titulo={`Lançar estoque · ${produto.nome}`} tamanho="sm">
        {feito ? (
          <div className="space-y-4" data-lancamento-feito>
            <p className="flex items-center gap-2 text-sm font-semibold text-success-700">
              <CheckCircle2 className="w-4 h-4" /> Lançado. Saldo agora: {formatarQtd(feito.saldo)} {un}
            </p>
            {feito.aviso && (
              <p role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {feito.aviso}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={abrir}>Lançar outro</Button>
              <Button type="button" onClick={fechar}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-4" noValidate>
            <div role="tablist" aria-label="Tipo de lançamento" className="grid grid-cols-3 gap-1 p-1 bg-surface-alt rounded-lg">
              {OPS.map((o) => (
                <button
                  key={o.id} type="button" role="tab" aria-selected={op === o.id}
                  onClick={() => { setOp(o.id); setErro(null); }}
                  className={cn("px-2 py-1.5 rounded-md text-sm font-semibold transition-colors", op === o.id ? "bg-white text-primary-700 shadow-sm" : "text-ink-muted hover:text-ink")}
                >{o.label}</button>
              ))}
            </div>
            <p className="text-xs text-ink-muted">{OPS.find((o) => o.id === op)!.dica} Saldo atual: <strong className={cn(produto.saldo < 0 && "text-atrasado")}>{formatarQtd(produto.saldo)} {un}</strong></p>

            <FormField label={op === "ENTRADA" ? `Quantidade (${un})` : op === "AJUSTE" ? `Saldo correto (${un})` : `Quantidade contada (${un})`} required>
              <Input inputMode="decimal" autoFocus value={valor} onChange={(e) => setValor(e.target.value)} name="valor" placeholder="0" />
            </FormField>
            {op === "ENTRADA" && (
              <FormField label="Custo unitário (R$)" hint="Opcional.">
                <Input inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} name="custo" placeholder="0,00" />
              </FormField>
            )}
            <FormField label={op === "AJUSTE" ? "Motivo" : "Observação"} required={op === "AJUSTE"}>
              <Input value={obs} onChange={(e) => setObs(e.target.value)} name="observacao" maxLength={500} placeholder={op === "AJUSTE" ? "Ex.: perda, avaria, erro de lançamento" : "Opcional"} />
            </FormField>

            {previa && (op !== "ENTRADA" || previa.delta > 0) && (
              <p className="text-xs text-ink-muted" data-previa>
                Lançamento: <strong>{formatarDelta(previa.delta)} {un}</strong> → saldo fica{" "}
                <strong className={cn(arred(produto.saldo + previa.delta) < 0 && "text-atrasado")}>{formatarQtd(arred(produto.saldo + previa.delta))} {un}</strong>
              </p>
            )}
            {erro && <p role="alert" className="text-sm text-atrasado font-medium">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={fechar}>Cancelar</Button>
              <Button type="submit" loading={enviando}>Lançar</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
