"use client";

import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import type { EmitidoDaTela } from "@/components/colaborador/gerar-documento";

/**
 * CANCELAR um documento gerado. Cancelar não apaga: o papel fica no histórico com a razão, quem e
 * quando, e o arquivo sai da ficha com o mesmo rastro de qualquer exclusão de documento.
 *
 * Por isso pede o motivo escrito, em vez de um "tem certeza?": advertência cancelada sem razão é
 * um buraco na história da pessoa.
 */
export function CancelarDocumento({
  emitido, onFechar, onCancelado,
}: {
  emitido: EmitidoDaTela | null;
  onFechar: () => void;
  onCancelado: (emitido: EmitidoDaTela) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { setMotivo(""); setErro(""); setOcupado(false); }, [emitido]);

  async function cancelar() {
    if (!emitido) return;
    if (motivo.trim().length < 3) { setErro("Diga por que está cancelando."); return; }
    setOcupado(true); setErro("");
    try {
      const r = await fetch(`/api/documentos-gerados/${emitido.id}/cancelar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(json?.erro ?? "Não foi possível cancelar."); return; }
      onCancelado(json);
      toast("Documento cancelado. O registro fica no histórico.");
      onFechar();
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto={!!emitido} onFechar={onFechar} titulo="Cancelar o documento">
      <div className="space-y-4" data-cancelar-documento>
        {erro && (
          <div role="alert" data-erro-cancelar className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">
            {erro}
          </div>
        )}
        <p className="text-sm text-ink-muted">
          <strong className="text-ink">{emitido?.titulo}</strong> sai da ficha. O registro de que ele existiu
          fica no histórico, com a razão, quem cancelou e quando.
        </p>
        <FormField label="Por que está cancelando" required>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500}
            data-motivo-cancelamento placeholder="Ex.: equipamento trocado no mesmo dia" />
        </FormField>
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <Button type="button" variant="secondary" onClick={onFechar}>Voltar</Button>
          <Button type="button" variant="danger" loading={ocupado} onClick={cancelar} data-confirmar-cancelamento>
            <Ban className="w-4 h-4" /> Cancelar o documento
          </Button>
        </div>
      </div>
    </Modal>
  );
}
