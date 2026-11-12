"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Modal } from "@/components/ui/modal";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { dataBR, hojeISO } from "@/lib/pmoc";
import { rotuloFrequencia } from "@/lib/pmoc-cronograma";
import { TEXTO_MOTIVO_FORA, avisosDaVigencia, dataValida, planejarRenovacao } from "@/lib/pmoc-renovacao";
import type { PreviaRenovacao } from "@/lib/pmoc-renovacao-server";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * "Renovar": cria o plano da próxima vigência, em rascunho, já com os equipamentos ativos e o
 * cronograma. O diálogo propõe as datas, deixa mudar e mostra o que vai e o que não vai (a ART não
 * vai). Exige pmoc.editar.
 */
export function PmocRenovar({ pmocId }: { pmocId: string }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [aberto, setAberto] = useState(false);
  const [previa, setPrevia] = useState<PreviaRenovacao | null>(null);
  const [form, setForm] = useState({ nome: "", dataInicio: "", dataExpiracao: "" });
  const [erro, setErro] = useState("");
  const [renovando, setRenovando] = useState(false);

  const datasOk = dataValida(form.dataInicio) && dataValida(form.dataExpiracao) && form.dataExpiracao > form.dataInicio;
  const plano = useMemo(
    () => (previa && datasOk ? planejarRenovacao({ pmoc: previa.pmoc, equipamentos: previa.equipamentos, itens: previa.itens }, form) : null),
    [previa, datasOk, form],
  );
  if (!pode("pmoc", "editar")) return null;

  async function abrir() {
    setErro(""); setPrevia(null); setAberto(true);
    try {
      const res = await fetch(`/api/pmocs/${pmocId}/renovacao`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível carregar a renovação."); return; }
      setPrevia(d); setForm(d.proposta);
    } catch { setErro("Erro de conexão."); }
  }
  async function renovar() {
    setErro(""); setRenovando(true);
    try {
      const res = await fetch(`/api/pmocs/${pmocId}/renovacao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível renovar o PMOC."); return; }
      setAberto(false);
      router.push(`/pmoc/${d.id}?renovado=1`);
    } catch { setErro("Erro de conexão."); } finally { setRenovando(false); }
  }

  const rotulo = (id: string) => previa?.equipamentos.find((e) => e.id === id)?.rotulo ?? "Equipamento";
  const item = (id: string) => previa?.itens.find((i) => i.id === id);
  const avisos = previa && datasOk ? avisosDaVigencia(previa.pmoc, form, hojeISO()) : [];

  return (
    <>
      <button type="button" onClick={abrir} data-renovar
        className="inline-flex items-center gap-1.5 text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-ink hover:bg-surface-alt font-medium">
        <RefreshCw className="w-4 h-4" /> Renovar
      </button>
      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo="Renovar PMOC" tamanho="lg">
        <div className="space-y-4" data-modal-renovar>
          <p className="text-sm text-ink-muted">
            <span>Cria o plano da próxima vigência, já com o cronograma. </span>
            <span>Ele nasce em rascunho: nenhuma OS é gerada até publicar.</span>
          </p>
          {!previa && !erro && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>}
          {previa && (
            <>
              {previa.renovacoes.length > 0 && (
                <p className="text-sm text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2" data-ja-renovado>
                  Este plano já tem renovação:{" "}
                  {previa.renovacoes.map((r, n) => (
                    <span key={r.id}>{n > 0 && ", "}<Link href={`/pmoc/${r.id}`} className="font-semibold underline">{r.nome}</Link></span>
                  ))}. Renovar de novo cria outro plano.
                </p>
              )}
              <FormField label="Nome do novo plano" required>
                <Input aria-label="Nome do novo plano" value={form.nome} maxLength={150} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
              </FormField>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Data de início" required hint={`A vigência atual termina em ${dataBR(previa.pmoc.dataExpiracao)}`}>
                  <InputData aria-label="Data de início da nova vigência" value={form.dataInicio} onChange={(iso) => setForm((f) => ({ ...f, dataInicio: iso }))} />
                </FormField>
                <FormField label="Data de expiração" required>
                  <InputData aria-label="Data de expiração da nova vigência" value={form.dataExpiracao} onChange={(iso) => setForm((f) => ({ ...f, dataExpiracao: iso }))} />
                </FormField>
              </div>
              {avisos.map((a) => <p key={a} className="text-xs text-atencao-texto" data-aviso-vigencia>{a}</p>)}
              {!plano ? <p className="text-sm text-ink-muted" data-sem-datas>Informe as duas datas, com a expiração depois do início.</p> : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <section className="border border-ok/20 bg-ok-claro rounded-lg px-3 py-2.5 space-y-1.5" data-vai>
                    <h4 className="text-sm font-semibold text-ok-texto flex items-center gap-1.5"><Check className="w-4 h-4" /> O que vai</h4>
                    <ul className="text-sm text-ink space-y-1.5">
                      <li>Cliente, unidade, responsável técnico e texto técnico.</li>
                      <li data-equipamentos-vao>{plural(plano.equipamentoIds.length, "equipamento ativo", "equipamentos ativos")}.</li>
                      <li data-itens-vao>{plural(plano.itens.length, "item do cronograma", "itens do cronograma")}, com o início na nova vigência{plano.itens.length ? ":" : "."}</li>
                    </ul>
                    {plano.itens.length > 0 && (
                      <ul className="text-xs text-ink-muted space-y-1 pl-3 border-l border-ok/30">
                        {plano.itens.map((i) => (
                          <li key={i.origemId} data-item-renovado>
                            <span className="text-ink font-medium">{item(i.origemId)?.servico}</span> · {item(i.origemId)?.aplicaA} · {rotuloFrequencia(i.intervaloMeses)}, dia {i.diaExecucao}
                            {" · "}a partir de <strong>{dataBR(i.dataInicio)}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="border border-surface-border bg-surface-alt rounded-lg px-3 py-2.5 space-y-1.5" data-nao-vai>
                    <h4 className="text-sm font-semibold text-ink flex items-center gap-1.5"><X className="w-4 h-4" /> O que não vai</h4>
                    <ul className="text-sm text-ink space-y-1.5">
                      <li data-art-nao-vai><strong>ART</strong> (número e arquivo): cada vigência tem a sua. Anexe a nova antes de publicar.</li>
                      <li>Link público, histórico, avisos e as OS já geradas.</li>
                      {plano.equipamentosFora.length > 0 && (
                        <li data-equipamentos-fora>{plural(plano.equipamentosFora.length, "equipamento inativo", "equipamentos inativos")}: {plano.equipamentosFora.map(rotulo).join(", ")}.</li>
                      )}
                      {plano.itensFora.map((f) => (
                        <li key={f.id} data-item-fora>Item {item(f.id)?.servico} · {item(f.id)?.aplicaA}: {TEXTO_MOTIVO_FORA[f.motivo]}.</li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
            </>
          )}
          {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-renovacao>{erro}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="button" loading={renovando} disabled={!previa} onClick={renovar} data-confirmar-renovacao><RefreshCw className="w-4 h-4" /> Renovar</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
