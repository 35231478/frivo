"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function SincronizarBoletos() {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState("");

  async function sincronizar() {
    setCarregando(true); setMsg("");
    try {
      const res = await fetch("/api/inter/sincronizar", { method: "POST" });
      const d = await res.json();
      if (res.ok) {
        setMsg(`${d.pagos} pago(s), ${d.cancelados} cancelado(s) de ${d.total}.`);
        router.refresh();
      } else setMsg(d.erro ?? "Erro ao sincronizar.");
    } catch { setMsg("Erro de conexão."); } finally { setCarregando(false); }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-ink-muted">{msg}</span>}
      <Button type="button" variant="secondary" loading={carregando} onClick={sincronizar}>
        <RefreshCw className="w-4 h-4" /> Sincronizar boletos
      </Button>
    </div>
  );
}
