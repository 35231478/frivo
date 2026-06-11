"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, X, Check, Trash2, HardDrive, ClipboardList, CircleCheck, CircleDashed, AlertCircle } from "lucide-react";

interface Props {
  osId: string;
  atividadeId: string;
  clienteId?: string;
  unidadeId?: string | null;
  temTipoOs: boolean;
}

interface Vinculo {
  id: string;
  feito: boolean;
  equipamento: { id: string; nome?: string | null; marca: string; modelo: string; localizacao?: string | null; tipo: string; tipoEquipamento?: { id: string; nome: string } | null };
}

function rotuloEquip(e: Vinculo["equipamento"]) {
  const base = `${e.marca} ${e.modelo}`.trim();
  return e.nome ? `${e.nome} — ${base}` : base;
}

export function AtividadeEquipamentos({ osId, atividadeId, clienteId, unidadeId, temTipoOs }: Props) {
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [disponiveis, setDisponiveis] = useState<any[]>([]);
  const [forms, setForms] = useState<{ grupos: any[]; tiposSemFormulario: any[] } | null>(null);
  const [mostraAdd, setMostraAdd] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);

  const base = `/api/ordens/${osId}/atividades/${atividadeId}`;

  const carregarForms = useCallback(() => {
    fetch(`${base}/formularios`).then((r) => r.json()).then(setForms).catch(() => {});
  }, [base]);

  useEffect(() => {
    fetch(`${base}/equipamentos`).then((r) => r.json()).then((d) => setVinculos(Array.isArray(d) ? d : [])).catch(() => {});
    carregarForms();
    const qs = unidadeId ? `unidadeId=${unidadeId}` : clienteId ? `clienteId=${clienteId}` : "";
    fetch(`/api/equipamentos${qs ? `?${qs}` : ""}`).then((r) => r.json()).then((d) => setDisponiveis(Array.isArray(d) ? d : [])).catch(() => {});
  }, [base, carregarForms, clienteId, unidadeId]);

  async function adicionar() {
    if (selecionados.size === 0) return;
    setSalvando(true);
    try {
      const res = await fetch(`${base}/equipamentos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipamentoIds: [...selecionados] }),
      });
      if (res.ok) {
        setVinculos(await res.json());
        setSelecionados(new Set());
        setMostraAdd(false);
        carregarForms();
      }
    } finally { setSalvando(false); }
  }

  async function remover(vinculoId: string) {
    const res = await fetch(`${base}/equipamentos/${vinculoId}`, { method: "DELETE" });
    if (res.ok) {
      setVinculos((p) => p.filter((v) => v.id !== vinculoId));
      carregarForms();
    }
  }

  const jaVinculados = new Set(vinculos.map((v) => v.equipamento.id));
  const candidatos = disponiveis.filter((e) => !jaVinculados.has(e.id));

  return (
    <div className="space-y-4">
      {/* ── Equipamentos da atividade ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5" /> Equipamentos da atividade
          </p>
          {!mostraAdd && (
            <button onClick={() => setMostraAdd(true)} className="text-xs text-frivo-600 hover:text-frivo-700 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Adicionar
            </button>
          )}
        </div>

        {vinculos.length === 0 && !mostraAdd && (
          <p className="text-xs text-gray-400">Nenhum equipamento adicionado.</p>
        )}

        <div className="space-y-1">
          {vinculos.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-gray-800 truncate">{rotuloEquip(v.equipamento)}</span>
                {v.equipamento.tipoEquipamento && (
                  <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">{v.equipamento.tipoEquipamento.nome}</span>
                )}
                {v.feito && <CircleCheck className="w-3.5 h-3.5 text-green-500 shrink-0" />}
              </div>
              <button onClick={() => remover(v.id)} className="p-1 text-gray-300 hover:text-red-600 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>

        {mostraAdd && (
          <div className="mt-2 border border-frivo-200 bg-frivo-50/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-frivo-800">Selecione os equipamentos</span>
              <button onClick={() => { setMostraAdd(false); setSelecionados(new Set()); }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            {candidatos.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhum equipamento disponível para adicionar.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {candidatos.map((e) => {
                  const checked = selecionados.has(e.id);
                  return (
                    <label key={e.id} className="flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-100 rounded px-2 py-1.5 cursor-pointer hover:border-frivo-200">
                      <input type="checkbox" checked={checked} className="accent-frivo-600"
                        onChange={() => setSelecionados((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
                      <span className="truncate">{rotuloEquip(e)}</span>
                      {e.localizacao && <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">{e.localizacao}</span>}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" loading={salvando} onClick={adicionar} disabled={selecionados.size === 0} className="h-7 text-xs px-3">
                <Check className="w-3.5 h-3.5" /> Adicionar {selecionados.size > 0 ? `(${selecionados.size})` : ""}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Formulários desta atividade ── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-1.5 mb-2">
          <ClipboardList className="w-3.5 h-3.5" /> Formulários desta atividade
        </p>

        {!temTipoOs && (
          <p className="text-xs text-amber-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Defina o Tipo de OS da atividade para vincular formulários.</p>
        )}

        {temTipoOs && forms && forms.grupos.length === 0 && (forms.tiposSemFormulario?.length ?? 0) === 0 && (
          <p className="text-xs text-gray-400">Nenhum formulário aplicável aos equipamentos desta atividade.</p>
        )}

        <div className="space-y-2">
          {forms?.grupos.map((g) => (
            <div key={g.tipoEquipamentoId} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold text-gray-700">{g.tipoEquipamentoNome}</span>
                  <span className="text-[10px] text-gray-400">→ {g.formulario.nome}</span>
                </div>
                <span className="text-[10px] text-gray-500 whitespace-nowrap">{g.resumo.respondidos}/{g.resumo.total} respondidos</span>
              </div>
              <div className="divide-y divide-gray-50">
                {g.equipamentos.map((e: any) => (
                  <div key={e.equipamentoId} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-sm text-gray-700 truncate">{e.nome ? `${e.nome} — ` : ""}{e.marca} {e.modelo}</span>
                    {e.completo ? (
                      <span className="text-[10px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap"><CircleCheck className="w-3 h-3" /> Respondido</span>
                    ) : e.respondido ? (
                      <span className="text-[10px] text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">Parcial</span>
                    ) : (
                      <span className="text-[10px] text-gray-400 flex items-center gap-1 whitespace-nowrap"><CircleDashed className="w-3 h-3" /> Pendente</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {forms?.tiposSemFormulario?.map((t: any) => (
            <p key={t.id} className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3" /> {t.nome}: {t.qtd} equipamento(s) sem formulário vinculado para este tipo de OS.
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
