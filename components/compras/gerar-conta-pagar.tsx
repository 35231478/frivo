"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";

export function GerarContaPagar({ pedidoId, jaExiste }: { pedidoId: string; jaExiste: boolean }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);

  async function gerar() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/contas-pagar/do-pedido/${pedidoId}`, { method: "POST" });
      if (res.ok) router.push("/financeiro/contas-pagar");
      else { const e = await res.json(); alert(e.erro ?? "Erro ao gerar conta a pagar."); }
    } catch { alert("Erro de conexão."); } finally { setCarregando(false); }
  }

  return (
    <Button type="button" variant="secondary" loading={carregando} onClick={gerar}>
      <Wallet className="w-4 h-4" /> {jaExiste ? "Ver conta a pagar" : "Gerar conta a pagar"}
    </Button>
  );
}
