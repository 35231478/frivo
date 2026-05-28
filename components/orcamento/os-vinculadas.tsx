"use client";

import { useEffect, useState } from "react";
import { cn, LABELS_STATUS_OS } from "@/lib/utils";
import { ClipboardList } from "lucide-react";

interface OsItem {
  id: string;
  numero: string;
  descricao: string;
  status: string;
}

interface OsVinculadasProps {
  clienteId: string | null;
  selecionadas: string[];
  onChange: (ids: string[]) => void;
  /** OSs já incluídas no formulário (mesmo se o cliente não estiver selecionado ainda) */
  osPreCarregadas?: OsItem[];
}

export function OsVinculadas({ clienteId, selecionadas, onChange, osPreCarregadas }: OsVinculadasProps) {
  const [ordens, setOrdens] = useState<OsItem[]>(osPreCarregadas ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clienteId) {
      setOrdens(osPreCarregadas ?? []);
      return;
    }
    setLoading(true);
    fetch(`/api/ordens?clienteId=${clienteId}`)
      .then((r) => r.json())
      .then((data: any[]) => {
        const lista = data.map((o) => ({
          id: o.id,
          numero: o.numero,
          descricao: o.descricao,
          status: o.status,
        }));
        // garante que IDs já selecionados também aparecem mesmo se vieram de outro cliente
        const idsConhecidos = new Set(lista.map((o) => o.id));
        const extras = (osPreCarregadas ?? []).filter((o) => !idsConhecidos.has(o.id));
        setOrdens([...lista, ...extras]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clienteId, osPreCarregadas]);

  function toggle(id: string) {
    if (selecionadas.includes(id)) {
      onChange(selecionadas.filter((x) => x !== id));
    } else {
      onChange([...selecionadas, id]);
    }
  }

  return (
    <div className="space-y-2">
      {!clienteId && (
        <p className="text-sm text-ink-subtle italic">Selecione um cliente para listar as OS disponíveis.</p>
      )}
      {clienteId && loading && (
        <p className="text-sm text-ink-subtle">Carregando ordens de serviço...</p>
      )}
      {clienteId && !loading && ordens.length === 0 && (
        <p className="text-sm text-ink-subtle italic">Este cliente ainda não tem ordens de serviço.</p>
      )}
      {ordens.length > 0 && (
        <div className="max-h-64 overflow-y-auto border border-surface-border rounded-lg divide-y divide-surface-border">
          {ordens.map((os) => {
            const ativo = selecionadas.includes(os.id);
            return (
              <label
                key={os.id}
                className={cn(
                  "flex items-start gap-3 p-3 cursor-pointer transition-colors",
                  ativo ? "bg-primary-50" : "hover:bg-surface-alt"
                )}
              >
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={() => toggle(os.id)}
                  className="mt-1 w-4 h-4 accent-primary-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-3.5 h-3.5 text-primary-600" />
                    <span className="font-mono text-sm font-semibold text-primary-700">{os.numero}</span>
                    <span className="text-xs text-ink-muted">
                      {LABELS_STATUS_OS[os.status] ?? os.status}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted line-clamp-2 mt-0.5">{os.descricao}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
