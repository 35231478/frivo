"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Check, DollarSign, X } from "lucide-react";

export function ContaReceberAcoes({ contaId, status }: { contaId: string; status: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [forma, setForma] = useState("BOLETO");

  async function atualizar(payload: Record<string, unknown>) {
    setSalvando(true);
    try {
      const res = await fetch(`/api/contas-receber/${contaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) { setAberto(false); router.refresh(); }
    } finally {
      setSalvando(false);
    }
  }

  if (status === "RECEBIDO" || status === "CANCELADO") {
    return <span className="text-xs text-ink-subtle">—</span>;
  }

  if (!aberto) {
    return (
      <Button size="sm" variant="success" onClick={() => setAberto(true)}>
        <DollarSign className="w-3.5 h-3.5" /> Receber
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-36 py-1.5" />
      <Select value={forma} onChange={(e) => setForma(e.target.value)} className="w-32 py-1.5">
        {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <Button size="sm" variant="success" loading={salvando}
        onClick={() => atualizar({ status: "RECEBIDO", dataRecebimento: data, formaPagamento: forma })}>
        <Check className="w-3.5 h-3.5" />
      </Button>
      <button onClick={() => setAberto(false)} className="p-1.5 text-ink-muted hover:text-ink"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}
