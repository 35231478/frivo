"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { MESES_PT } from "@/lib/utils";
import { CalendarRange, X, Check, AlertCircle } from "lucide-react";

export function GerarMedicoesMes() {
  const router = useRouter();
  const agora = new Date();
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(agora.getMonth() + 1);
  const [ano, setAno] = useState(agora.getFullYear());
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<{ criadas: number; ignoradas: number } | null>(null);
  const [erro, setErro] = useState("");

  async function gerar() {
    setGerando(true);
    setErro("");
    setResultado(null);
    try {
      const res = await fetch("/api/medicoes/gerar-mes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, ano }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErro(err.erro ?? "Erro ao gerar medições.");
        return;
      }
      const data = await res.json();
      setResultado({ criadas: data.criadas, ignoradas: data.ignoradas });
      router.refresh();
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setGerando(false);
    }
  }

  if (!aberto) {
    return (
      <Button variant="outline" onClick={() => setAberto(true)}>
        <CalendarRange className="w-4 h-4" /> Gerar medições do mês
      </Button>
    );
  }

  return (
    <div className="absolute right-0 top-full mt-2 z-20 w-80 bg-white border border-surface-border rounded-xl shadow-card-hover p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-ink">Gerar medições mensais</h4>
        <button onClick={() => { setAberto(false); setResultado(null); setErro(""); }} className="text-ink-muted hover:text-ink">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        Gera medições para todos os clientes com contrato ativo, respeitando o perfil de faturamento.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={String(mes)} onChange={(e) => setMes(Number(e.target.value))}>
          {MESES_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </Select>
        <Input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value) || agora.getFullYear())} />
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {erro}
        </div>
      )}
      {resultado && (
        <div className="bg-success-50 border border-success-200 text-success-700 text-xs rounded-lg px-3 py-2 flex items-center gap-2">
          <Check className="w-3.5 h-3.5" /> {resultado.criadas} criada(s), {resultado.ignoradas} ignorada(s).
        </div>
      )}

      <Button onClick={gerar} loading={gerando} className="w-full justify-center">
        <CalendarRange className="w-4 h-4" /> Gerar agora
      </Button>
    </div>
  );
}
