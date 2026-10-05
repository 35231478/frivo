"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

type Duplicado = { id: string; descricao: string; fabricanteModelo: string; local: string; ativo: boolean };

/**
 * Aviso (não bloqueia) quando o nº de série digitado/lido já existe em outro
 * equipamento da empresa — normalmente a mesma etiqueta cadastrada duas vezes.
 */
export function AvisoSerieDuplicada({ numero, ignorarId }: { numero: string; ignorarId?: string }) {
  const [duplicados, setDuplicados] = useState<Duplicado[]>([]);

  useEffect(() => {
    const n = numero.trim();
    if (n.length < 3) { setDuplicados([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ numero: n, ...(ignorarId && { ignorar: ignorarId }) });
      fetch(`/api/equipamentos/serie?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { duplicados: [] }))
        .then((d) => setDuplicados(Array.isArray(d?.duplicados) ? d.duplicados : []))
        .catch(() => {});
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [numero, ignorarId]);

  if (!duplicados.length) return null;
  return (
    <div data-aviso-serie className="mt-1.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Este nº de série já está cadastrado{duplicados.length > 1 ? ` em ${duplicados.length} equipamentos` : ""}. Confira se não é a mesma etiqueta.
      </p>
      <ul className="mt-1 ml-5 list-disc space-y-0.5">
        {duplicados.map((d) => (
          <li key={d.id}>
            <Link href={`/equipamentos/${d.id}`} target="_blank" className="underline hover:text-amber-700">
              {d.descricao}{d.fabricanteModelo ? ` · ${d.fabricanteModelo}` : ""}
            </Link>
            {d.local ? ` — ${d.local}` : ""}{!d.ativo ? " (inativo)" : ""}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-amber-800">É só um aviso: você pode salvar mesmo assim.</p>
    </div>
  );
}
