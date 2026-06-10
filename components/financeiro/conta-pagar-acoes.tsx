"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatarMoeda, formatarData, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { DollarSign, History, Pencil, Ban, Upload } from "lucide-react";

interface Conta {
  id: string; numero: string; fornecedor: string;
  valorTotal: number; valorPago: number; saldoRestante: number; status: string;
}

export function ContaPagarAcoes({ conta }: { conta: Conta }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "pagar" | "historico">(null);
  const fechar = () => setModal(null);
  const finalizada = conta.status === "PAGO_TOTAL" || conta.status === "CANCELADO";

  async function cancelar() {
    if (!confirm(`Cancelar a conta ${conta.numero}?`)) return;
    await fetch(`/api/contas-pagar/${conta.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-end gap-0.5">
        {!finalizada && (
          <button type="button" title="Registrar pagamento" onClick={() => setModal("pagar")} className="p-1.5 rounded text-emerald-600 hover:bg-surface-alt"><DollarSign className="w-4 h-4" /></button>
        )}
        <button type="button" title="Histórico de pagamentos" onClick={() => setModal("historico")} className="p-1.5 rounded text-ink-muted hover:bg-surface-alt"><History className="w-4 h-4" /></button>
        {!finalizada && (
          <Link href={`/financeiro/contas-pagar/${conta.id}/editar`} title="Editar" className="p-1.5 rounded text-primary-600 hover:bg-surface-alt"><Pencil className="w-4 h-4" /></Link>
        )}
        {conta.status !== "CANCELADO" && (
          <button type="button" title="Cancelar conta" onClick={cancelar} className="p-1.5 rounded text-red-600 hover:bg-red-50"><Ban className="w-4 h-4" /></button>
        )}
      </div>

      <Modal aberto={modal === "pagar"} onFechar={fechar} titulo={`Pagamento — ${conta.numero}`} tamanho="lg">
        <PagamentoParcial conta={conta} onPronto={() => { fechar(); router.refresh(); }} />
      </Modal>

      <Modal aberto={modal === "historico"} onFechar={fechar} titulo={`Histórico — ${conta.numero}`}>
        <Historico contaId={conta.id} />
      </Modal>
    </>
  );
}

function PagamentoParcial({ conta, onPronto }: { conta: Conta; onPronto: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [valor, setValor] = useState(String(conta.saldoRestante));
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("");
  const [banco, setBanco] = useState("");
  const [obs, setObs] = useState("");
  const [comprovante, setComprovante] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const valorNum = Number(valor) || 0;
  const saldoApos = Math.max(0, conta.saldoRestante - valorNum);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErro("Comprovante muito grande (máx 3 MB)."); return; }
    const reader = new FileReader();
    reader.onload = () => setComprovante(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function confirmar() {
    setErro("");
    if (valorNum <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    try {
      const res = await fetch(`/api/contas-pagar/${conta.id}/pagamentos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: valorNum, dataPagamento: data, formaPagamento: forma || null, banco: banco || null, comprovante, observacao: obs || null }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao registrar pagamento."); return; }
      onPronto();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-alt rounded-lg p-3 text-center"><p className="text-xs text-ink-muted">Valor total</p><p className="text-sm font-bold text-ink mt-1">{formatarMoeda(conta.valorTotal)}</p></div>
        <div className="bg-surface-alt rounded-lg p-3 text-center"><p className="text-xs text-ink-muted">Já pago</p><p className="text-sm font-bold text-success-700 mt-1">{formatarMoeda(conta.valorPago)}</p></div>
        <div className="bg-amber-50 rounded-lg p-3 text-center"><p className="text-xs text-ink-muted">Após este pagamento</p><p className="text-sm font-bold text-amber-700 mt-1">{formatarMoeda(saldoApos)}</p></div>
      </div>

      <FormGrid>
        <FormField label="Valor a pagar agora">
          <div className="flex gap-2">
            <Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="flex-1" />
            <Button type="button" variant="secondary" onClick={() => setValor(String(conta.saldoRestante))} className="shrink-0 text-xs px-2.5">Total</Button>
          </div>
        </FormField>
        <FormField label="Data do pagamento"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="">Selecione…</option>
            {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
        <FormField label="Banco utilizado"><Input value={banco} onChange={(e) => setBanco(e.target.value)} /></FormField>
      </FormGrid>
      <FormField label="Comprovante (opcional)">
        <input ref={fileRef} type="file" onChange={handleFile} className="hidden" />
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} className="text-xs py-1.5 px-3"><Upload className="w-3.5 h-3.5" /> {comprovante ? "Trocar" : "Anexar"}</Button>
          {comprovante && <span className="text-xs text-success-600">Comprovante anexado</span>}
        </div>
      </FormField>
      <FormField label="Observação"><Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} /></FormField>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onPronto}>Cancelar</Button>
        <Button loading={salvando} onClick={confirmar}><DollarSign className="w-4 h-4" /> Registrar pagamento</Button>
      </div>
    </div>
  );
}

function Historico({ contaId }: { contaId: string }) {
  const [pagamentos, setPagamentos] = useState<any[] | null>(null);
  if (pagamentos === null) {
    fetch(`/api/contas-pagar/${contaId}/pagamentos`).then((r) => r.json()).then((d) => setPagamentos(Array.isArray(d) ? d : [])).catch(() => setPagamentos([]));
    return <p className="text-sm text-ink-subtle text-center py-6">Carregando…</p>;
  }
  if (pagamentos.length === 0) return <p className="text-sm text-ink-subtle text-center py-6">Nenhum pagamento registrado.</p>;
  return (
    <ul className="divide-y divide-surface-border">
      {pagamentos.map((p) => (
        <li key={p.id} className="flex items-center justify-between py-2.5">
          <div>
            <p className="text-sm font-semibold text-ink">{formatarMoeda(Number(p.valor))}</p>
            <p className="text-xs text-ink-muted">{formatarData(p.dataPagamento)}{p.formaPagamento ? ` · ${LABELS_FORMA_PAGAMENTO[p.formaPagamento]}` : ""}{p.banco ? ` · ${p.banco}` : ""}</p>
          </div>
          {p.observacao && <span className="text-xs text-ink-subtle max-w-[200px] truncate">{p.observacao}</span>}
        </li>
      ))}
    </ul>
  );
}
