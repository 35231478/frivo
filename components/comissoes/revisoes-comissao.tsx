"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { MOTIVO_REVISAO_MIN } from "@/lib/comissoes/executor";
import type { RevisaoNaTela } from "@/lib/comissoes/executor-server";

const DICA = "Outra OS de retorno no mesmo equipamento, dentro dos dias da configuração: a comissão do técnico daquele serviço fica parada até alguém decidir. Estornar zera a comissão (o que já foi pago desconta no mês seguinte). Manter libera normalmente. Ninguém decide a própria.";
const ROTULO: Record<RevisaoNaTela["situacao"], string> = { A_REVISAR: "A revisar", ESTORNAR: "Estornada", MANTER: "Mantida" };

/**
 * COM-2 — "Estornos a revisar" (Desempenho › Fechamento): o retorno no mesmo equipamento segura a comissão do
 * técnico até o encarregado decidir, com motivo. Some quando a empresa não tem nenhuma revisão.
 */
export function RevisoesDeComissao() {
  const [lista, setLista] = useState<RevisaoNaTela[] | null>(null);
  const [decidindo, setDecidindo] = useState<{ r: RevisaoNaTela; decisao: "ESTORNAR" | "MANTER" } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/comissoes/revisoes").catch(() => null);
    if (r?.ok) setLista(((await r.json()) as { revisoes: RevisaoNaTela[] }).revisoes);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function decidir() {
    if (!decidindo) return;
    setSalvando(true); setErro(null);
    try {
      const r = await fetch(`/api/comissoes/revisoes/${decidindo.r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisao: decidindo.decisao, motivo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível registrar a decisão."); return; }
      toast(decidindo.decisao === "ESTORNAR" ? "Comissão estornada." : "Comissão mantida.");
      setDecidindo(null); setMotivo("");
      await carregar();
    } finally { setSalvando(false); }
  }

  if (!lista || !lista.length) return null;
  const abertas = lista.filter((r) => r.situacao === "A_REVISAR").length;
  return (
    <section className="card-padded space-y-3" data-revisoes-comissao>
      <div className="flex items-center gap-1.5">
        <RotateCcw className="w-4 h-4 text-ink-muted" aria-hidden />
        <h2 className="text-sm font-semibold text-ink">Estornos a revisar</h2>
        <Dica rotulo="Estornos a revisar" texto={DICA} />
        {abertas > 0 && <span className="ml-1 rounded-full bg-atencao-claro px-2 py-0.5 text-xs font-semibold text-atencao-texto" data-revisoes-abertas>{abertas}</span>}
      </div>
      <ul className="divide-y divide-surface-border">
        {lista.map((r) => (
          <li key={r.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2" data-revisao={r.id} data-situacao={r.situacao}>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink"><span className="font-medium">{r.beneficiario}</span> · {formatarMoeda(r.valor)}</p>
              <p className="text-xs text-ink-muted">{r.descricao}</p>
              {r.situacao !== "A_REVISAR" && (
                <p className="text-xs text-ink-muted" data-decisao-revisao>
                  <span className={cn("font-semibold", r.situacao === "ESTORNAR" ? "text-atrasado-texto" : "text-ink")}>{ROTULO[r.situacao]}</span>
                  {r.decididoPorNome ? ` por ${r.decididoPorNome}` : ""}{r.decididoEm ? ` em ${formatarData(r.decididoEm)}` : ""}{r.motivo ? `: ${r.motivo}` : ""}
                </p>
              )}
            </div>
            {r.situacao === "A_REVISAR" && (
              <div className="flex gap-2 shrink-0">
                <Button type="button" variant="secondary" onClick={() => { setErro(null); setMotivo(""); setDecidindo({ r, decisao: "MANTER" }); }} data-manter>Manter</Button>
                <Button type="button" variant="danger" onClick={() => { setErro(null); setMotivo(""); setDecidindo({ r, decisao: "ESTORNAR" }); }} data-estornar>Estornar</Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Modal aberto={!!decidindo} onFechar={() => setDecidindo(null)} titulo={decidindo?.decisao === "ESTORNAR" ? "Estornar a comissão" : "Manter a comissão"} tamanho="sm">
        {decidindo && (
          <div className="space-y-3" data-form-revisao>
            <p className="text-sm text-ink-muted">{decidindo.r.beneficiario} · {formatarMoeda(decidindo.r.valor)} — {decidindo.r.descricao}</p>
            <label className="block text-sm text-ink space-y-1">
              <span>Motivo</span>
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500} data-motivo-revisao
                placeholder={decidindo.decisao === "ESTORNAR" ? "Ex.: o dreno voltou a entupir pelo mesmo motivo." : "Ex.: o retorno foi por outro defeito."} />
            </label>
            {erro && <p role="alert" className="text-sm text-atrasado-texto" data-erro-revisao>{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDecidindo(null)}>Cancelar</Button>
              <Button type="button" variant={decidindo.decisao === "ESTORNAR" ? "danger" : "primary"} onClick={decidir} loading={salvando}
                disabled={motivo.trim().length < MOTIVO_REVISAO_MIN} data-confirmar-revisao>
                {decidindo.decisao === "ESTORNAR" ? "Estornar" : "Manter"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
