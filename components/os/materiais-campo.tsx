"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Smartphone, Undo2 } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { confirmar, toast } from "@/components/ui/avisos";
import { horaBR } from "@/lib/fuso";
import { textoQuantidade } from "@/lib/tecnico/materiais";
import type { LinhaEscritorio } from "@/lib/execucao/materiais-campo";

const quando = (iso: string) => `${formatarData(iso)} ${horaBR(iso)}`;
const lerQtd = (t: string) => { const s = t.trim().replace(/\./g, "").replace(",", "."); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };

/**
 * OS › Materiais & Compras: o que os técnicos lançaram pelo app ("Materiais usados em campo"). O escritório corrige
 * a quantidade ou estorna — o estoque acerta só a diferença e fica registrado quem fez e quando (aqui e no
 * histórico da OS). Os estornados continuam na lista, riscados, como registro. Sem valores.
 */
export function MateriaisCampo({ osId, podeCorrigir, onMudou }: { osId: string; podeCorrigir: boolean; onMudou?: () => void }) {
  const [linhas, setLinhas] = useState<LinhaEscritorio[] | null>(null);
  const [editando, setEditando] = useState<LinhaEscritorio | null>(null);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/ordens/${osId}/materiais-campo`, { cache: "no-store" });
    setLinhas(r.ok ? (await r.json()).linhas : []);
  }, [osId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function estornar(l: LinhaEscritorio) {
    const ok = await confirmar({ titulo: "Estornar material?", mensagem: `${l.descricao} · ${textoQuantidade(l.quantidade, l.unidade)}. O estoque volta e o lançamento fica registrado como estornado.`, perigo: true, confirmarTexto: "Estornar" });
    if (!ok) return;
    const r = await fetch(`/api/ordens/${osId}/materiais-campo/${l.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => null);
    if (!r.ok) { toast(j?.erro ?? "Não foi possível estornar.", "erro"); return; }
    toast("Material estornado.");
    await carregar(); onMudou?.();
  }

  if (linhas === null) return <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>;
  if (!linhas.length) return null;
  return (
    <section className="space-y-3" data-materiais-campo>
      <h3 className="section-title inline-flex items-center gap-1.5"><Smartphone className="w-4 h-4 text-ink-subtle" /> Materiais usados em campo</h3>
      <ul className="rounded-card border border-surface-border bg-white divide-y divide-surface-border">
        {linhas.map((l) => {
          const estornado = !!l.removidoEm;
          return (
            <li key={l.id} className={cn("px-4 py-3 flex flex-wrap items-start gap-3", estornado && "bg-surface-alt")} data-linha-campo={l.id} data-estornado={estornado || undefined}>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className={cn("text-sm font-semibold text-ink", estornado && "line-through text-ink-muted")}>{l.descricao}</p>
                <p className="text-xs text-ink-muted">{[l.atividade, l.equipamento, l.veiculo && `Veículo ${l.veiculo}`, l.daSeparacao && "da separação da OS"].filter(Boolean).join(" · ")}</p>
                <p className="text-xs text-ink-muted" data-registro-campo>
                  {[`Lançado por ${l.criadoPor ?? "—"} em ${quando(l.criadoEm)}`, l.corrigidoEm && `corrigido por ${l.corrigidoPor ?? "—"} em ${quando(l.corrigidoEm)}`, l.removidoEm && `estornado por ${l.removidoPor ?? "—"} em ${quando(l.removidoEm)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className={cn("text-sm font-bold tabular-nums text-ink shrink-0", estornado && "line-through text-ink-muted")} data-qtd-campo>{textoQuantidade(l.quantidade, l.unidade)}</span>
              {podeCorrigir && !estornado && (
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setEditando(l)} aria-label={`Corrigir ${l.descricao}`} data-corrigir-campo><Pencil className="w-4 h-4" /> Corrigir</Button>
                  <Button variant="ghost" size="sm" onClick={() => estornar(l)} aria-label={`Estornar ${l.descricao}`} data-estornar-campo><Undo2 className="w-4 h-4" /> Estornar</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editando && <ModalCorrigir osId={osId} l={editando} onFechar={() => setEditando(null)} onSalvo={async () => { setEditando(null); await carregar(); onMudou?.(); }} />}
    </section>
  );
}

function ModalCorrigir({ osId, l, onFechar, onSalvo }: { osId: string; l: LinhaEscritorio; onFechar: () => void; onSalvo: () => void }) {
  const [qtd, setQtd] = useState(String(l.quantidade).replace(".", ","));
  const [salvando, setSalvando] = useState(false);
  const n = lerQtd(qtd);
  async function salvar() {
    setSalvando(true);
    const r = await fetch(`/api/ordens/${osId}/materiais-campo/${l.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantidade: n }) });
    const j = await r.json().catch(() => null);
    setSalvando(false);
    if (!r.ok) { toast(j?.erro ?? "Não foi possível corrigir.", "erro"); return; }
    if (j?.avisos?.length) toast(j.avisos.join(" "), "info"); else toast("Quantidade corrigida.");
    onSalvo();
  }
  return (
    <Modal aberto titulo="Corrigir material usado" onFechar={onFechar}>
      <div className="space-y-4" data-modal-corrigir-campo>
        <p className="text-sm text-ink"><span className="font-semibold">{l.descricao}</span> · lançado: {textoQuantidade(l.quantidade, l.unidade)}</p>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">Quantidade correta ({l.unidade})</span>
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" aria-label="Quantidade correta" className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando} disabled={!(n > 0)} data-salvar-correcao>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
