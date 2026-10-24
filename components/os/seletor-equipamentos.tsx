"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface EquipLista {
  id: string; nome?: string | null; marca: string; modelo: string; localizacao?: string | null; patrimonio?: string | null; ativo?: boolean;
  unidadeId?: string; unidade?: { id: string; nome: string } | null; tipoEquipamento?: { id: string; nome: string } | null;
}

export const rotuloEquipLista = (e: EquipLista) => `${e.nome ? `${e.nome} — ` : ""}${e.marca} ${e.modelo}`.trim();

/**
 * Lista de equipamentos ATIVOS da unidade (ou, sem unidade, do cliente) com busca e marcação — a
 * mesma na criação da OS, no detalhe da atividade e na execução. `versao` muda → recarrega (ex.:
 * depois de um cadastro rápido).
 */
export function SeletorEquipamentos({ clienteId, unidadeId, excluir = [], marcados, onChange, versao = 0, vazio }: {
  clienteId: string; unidadeId?: string | null; excluir?: string[]; marcados: Set<string>; onChange: (n: Set<string>) => void;
  versao?: number; vazio?: React.ReactNode;
}) {
  const [lista, setLista] = useState<EquipLista[] | null>(null);
  const [busca, setBusca] = useState("");
  useEffect(() => {
    if (!clienteId) { setLista([]); return; }
    let vivo = true;
    const qs = unidadeId ? `unidadeId=${unidadeId}` : `clienteId=${clienteId}`;
    fetch(`/api/equipamentos?${qs}`).then((r) => r.json()).then((d) => { if (vivo) setLista(Array.isArray(d) ? d : []); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [clienteId, unidadeId, versao]);

  const fora = new Set(excluir);
  const termo = busca.trim().toLowerCase();
  const disponiveis = (lista ?? []).filter((e) => e.ativo !== false && !fora.has(e.id));
  const candidatos = disponiveis
    .filter((e) => !termo || [e.nome, e.marca, e.modelo, e.localizacao, e.patrimonio, e.tipoEquipamento?.nome].some((v) => (v ?? "").toLowerCase().includes(termo)));

  function alternar(id: string) {
    const n = new Set(marcados);
    if (n.has(id)) n.delete(id); else n.add(id);
    onChange(n);
  }

  return (
    <div className="space-y-2" data-seletor-equipamentos>
      {disponiveis.length > 5 && <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, TAG, local, tipo…" aria-label="Buscar equipamento" />}
      {lista === null && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>}
      {lista !== null && candidatos.length === 0 && (
        <p className="text-xs text-ink-muted py-2" data-seletor-vazio>
          {termo ? "Nenhum equipamento encontrado." : disponiveis.length || (lista ?? []).length ? "Todos os equipamentos deste local já estão na atividade." : "Nenhum equipamento cadastrado neste local."}
          {!termo && vazio}
        </p>
      )}
      <div className="max-h-64 overflow-y-auto space-y-1.5">
        {candidatos.map((e) => (
          <label key={e.id} className="flex items-center gap-3 bg-white border border-surface-linha rounded-lg px-3 py-2 cursor-pointer hover:border-frivo-200" data-opcao-equipamento={e.id}>
            <input type="checkbox" className="accent-frivo-600 w-4 h-4 shrink-0" checked={marcados.has(e.id)} onChange={() => alternar(e.id)} />
            <span className="min-w-0">
              <span className="block text-sm text-ink truncate">{rotuloEquipLista(e)}</span>
              <span className="block text-[11px] text-ink-muted truncate">
                {[e.tipoEquipamento?.nome, e.localizacao, e.patrimonio && `TAG ${e.patrimonio}`, !unidadeId && e.unidade?.nome].filter(Boolean).join(" · ")}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
