"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Repeat } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/**
 * Gera de uma vez as OS dos contratos recorrentes do mês. Ação sensível (cria OS em lote): o botão
 * só aparece para quem pode criar OS ou editar contratos — a MESMA regra que o servidor exige.
 */
export function GerarOsRecorrentes({ mes, ano }: { mes: number; ano: number }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [gerando, setGerando] = useState(false);
  if (!pode("ordens", "criar") && !pode("contratos", "editar")) return null;

  async function gerar() {
    setGerando(true);
    try {
      const res = await fetch("/api/contratos/gerar-os-recorrentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, ano }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.erro ?? "Não foi possível gerar as OS do mês.", "erro"); return; }
      const criadas = Number(data.criadas) || 0;
      const ignoradas = Number(data.ignoradas) || 0;
      toast(criadas === 0
        ? "Nenhuma OS nova: as do mês já estavam geradas."
        : `${criadas === 1 ? "1 OS criada" : `${criadas} OS criadas`}${ignoradas ? `. ${ignoradas === 1 ? "1 já existia" : `${ignoradas} já existiam`}.` : "."}`);
      router.refresh();
    } catch {
      toast("Erro de conexão.", "erro");
    } finally {
      setGerando(false);
    }
  }

  return (
    <Button variant="outline" onClick={gerar} loading={gerando} data-gerar-recorrentes>
      <Repeat className="w-4 h-4" aria-hidden /> Gerar OS recorrentes do mês
    </Button>
  );
}
