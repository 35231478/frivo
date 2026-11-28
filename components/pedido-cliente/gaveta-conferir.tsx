"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, Loader2, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/avisos";
import { reais } from "@/lib/pedido-cliente/regra";
import { MSG_MOTIVO_RECUSA, limparMotivoRecusa } from "@/lib/pedido-cliente/lembretes";

interface PedidoConferir {
  id: string; numero: string; data: string; valor: number | null; observacao: string | null; situacao: string;
  /** Quem não pode conferir não vê Confirmar/Recusar (o servidor recusa do mesmo jeito) */
  podeConferir?: boolean;
  temAnexo: boolean; anexoNome: string | null; total: number; alerta: string | null; cliente: string; enviadoPor: string | null; criadoEm: string;
  ordens: { id: string; numero: string }[]; orcamentos: { id: string; codigo: string }[];
}

const dataBR = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });

/**
 * PC-2 — A CONFERÊNCIA do pedido de compra que o comprador anexou no portal (abre pela etiqueta
 * "Pedido recebido — conferir"). Mostra o pedido, o arquivo e o que ele cobre; CONFIRMAR liga às OS e libera o
 * faturamento; RECUSAR pede o motivo, que o cliente vê no portal.
 */
export function GavetaConferir({ aberto, onFechar, pedidoId }: { aberto: boolean; onFechar: () => void; pedidoId: string }) {
  const router = useRouter();
  const [p, setP] = useState<PedidoConferir | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setP(null); setErroCarga(null); setErro(null); setRecusando(false); setMotivo(""); setTentou(false);
    fetch(`/api/pedidos-cliente/${pedidoId}`).then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (vivo) setP(j); })
      .catch(() => { if (vivo) setErroCarga("Não foi possível carregar. Tente de novo."); });
    return () => { vivo = false; };
  }, [aberto, pedidoId]);

  async function enviar(acao: "confirmar" | "recusar") {
    setTentou(true); setErro(null);
    if (acao === "recusar" && !limparMotivoRecusa(motivo)) return;
    setEnviando(true);
    const res = await fetch(`/api/pedidos-cliente/${pedidoId}/conferir`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(acao === "recusar" ? { acao, motivo } : { acao }),
    }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setEnviando(false);
    if (!res?.ok) { setErro(j?.erro ?? "Não foi possível concluir a conferência."); return; }
    // Confirmado sem nada novo para ligar (os itens já tinham pedido): não diz que liberou o faturamento
    toast(acao === "recusar" ? "Pedido recusado. O cliente vê o motivo no portal."
      : j?.ligadas && (j.ligadas.os || j.ligadas.orcamentos) ? "Pedido do cliente confirmado. O faturamento foi liberado." : "Pedido do cliente confirmado.");
    if (acao === "confirmar" && j?.alerta) toast(j.alerta, "info");
    router.refresh();
    onFechar();
  }

  const conferindo = p?.situacao === "CONFERIR";
  const itens = p ? [...p.ordens.map((o) => o.numero), ...p.orcamentos.map((o) => `Orçamento ${o.codigo}`)] : [];
  return (
    <Drawer aberto={aberto} onFechar={onFechar} largura="sm:max-w-md" titulo="Conferir pedido do cliente"
      rodape={p && conferindo && p.podeConferir !== false && (
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
          {recusando
            ? <>
                <Button variant="secondary" onClick={() => { setRecusando(false); setTentou(false); }}>Voltar</Button>
                <Button variant="danger" onClick={() => enviar("recusar")} loading={enviando} data-confirmar-recusa><X className="w-4 h-4" aria-hidden /> Recusar pedido</Button>
              </>
            : <>
                <Button variant="secondary" onClick={() => { setRecusando(true); setTentou(false); setErro(null); }} data-recusar-pedido>Recusar…</Button>
                <Button onClick={() => enviar("confirmar")} loading={enviando} data-confirmar-pedido><Check className="w-4 h-4" aria-hidden /> Confirmar pedido</Button>
              </>}
        </div>
      )}>
      <div className="space-y-4" data-gaveta-conferir>
        {!p && !erroCarga && <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Carregando…</p>}
        {erroCarga && <p role="alert" className="text-sm text-atrasado-texto">{erroCarga}</p>}
        {p && (
          <>
            <p className="text-sm text-ink-muted">
              {conferindo
                ? <>O comprador do cliente anexou este pedido no portal. Confira o número, o valor e o arquivo. Ao confirmar, as OS ficam com o pedido e o faturamento segue.</>
                : <>Este pedido já foi conferido.</>}
            </p>
            <dl className="rounded-lg bg-surface-page px-3 py-2.5 text-sm grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5" data-pedido-conferir>
              <dt className="text-ink-muted">Cliente</dt><dd className="text-ink font-semibold">{p.cliente}</dd>
              <dt className="text-ink-muted">Pedido</dt><dd className="text-ink" data-conferir-numero>nº {p.numero} · {dataBR(p.data)}</dd>
              <dt className="text-ink-muted">Valor</dt><dd className="text-ink" data-conferir-valor>{p.valor != null ? reais(p.valor) : "não informado"}</dd>
              <dt className="text-ink-muted">Cobre</dt><dd className="text-ink" data-conferir-itens>{itens.join(", ") || "—"} <span className="text-ink-muted">· Total {reais(p.total)}</span></dd>
              {p.enviadoPor && <><dt className="text-ink-muted">Enviado por</dt><dd className="text-ink">{p.enviadoPor}</dd></>}
              {p.observacao && <><dt className="text-ink-muted">Observação</dt><dd className="text-ink">{p.observacao}</dd></>}
            </dl>
            {p.temAnexo && (
              <a href={`/api/pedidos-cliente/${p.id}/anexo?inline=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-acento hover:underline min-h-[44px]" data-conferir-anexo>
                <FileText className="w-4 h-4" aria-hidden /> Ver o pedido de compra{p.anexoNome ? ` (${p.anexoNome})` : ""}
              </a>
            )}
            {p.alerta && (
              <p className="flex items-start gap-2 text-sm text-atencao-texto bg-atencao-claro rounded-lg px-3 py-2" data-conferir-alerta-valor>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {p.alerta}
              </p>
            )}
            {recusando && (
              <FormField label="Motivo da recusa" hint="O cliente vê este motivo no portal." error={tentou && !limparMotivoRecusa(motivo) ? MSG_MOTIVO_RECUSA : undefined}>
                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={300} autoFocus data-motivo-recusa placeholder="Ex.: o valor do pedido não confere com a OS-1410" />
              </FormField>
            )}
            {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2" data-erro-conferir>{erro}</p>}
          </>
        )}
      </div>
    </Drawer>
  );
}

