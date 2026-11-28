"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { Button } from "@/components/ui/button";

/**
 * "Restaurar" uma nota descartada (lista "Notas descartadas"): reimporta pelo XML guardado no descarte
 * (POST /api/compras/notas/descartes/[id]/restaurar — o mesmo caminho da importação) e abre a nota.
 * Só aparece para quem descarta (Estoque › gerenciar) e no descarte que guardou o XML.
 * Nota já importada de novo: o erro diz e oferece abrir a que existe.
 */
export function RestaurarNota({ descarteId, numero, serie }: { descarteId: string; numero: string; serie: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; notaId?: string } | null>(null);

  async function restaurar() {
    setEnviando(true); setErro(null);
    const r = await fetch(`/api/compras/notas/descartes/${descarteId}/restaurar`, { method: "POST" }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setEnviando(false);
    if (!r?.ok) { setErro({ texto: j?.erro ?? "Não foi possível restaurar a nota.", notaId: j?.notaId }); return; }
    toast(`NF ${numero}/${serie} restaurada.`);
    router.push(`/estoque/notas/${j.nota.id}`);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={restaurar} loading={enviando} data-restaurar-nota={descarteId}
        title="Reimporta a nota pelo XML guardado no descarte, como uma importação nova. Fica registrado quem restaurou e quando.">
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Restaurar
      </Button>
      {erro && (
        <span role="alert" className="flex items-start gap-1.5 text-xs text-atrasado-texto" data-erro-restaurar>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{erro.texto}{erro.notaId && <> <Link href={`/estoque/notas/${erro.notaId}`} className="font-semibold underline">Abrir a nota importada</Link></>}</span>
        </span>
      )}
    </span>
  );
}
