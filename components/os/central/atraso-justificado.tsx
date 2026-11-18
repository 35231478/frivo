"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { confirmar, toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { formatarData } from "@/lib/utils";
import {
  MOTIVOS_ATRASO, MSG_ATRASO_OUTRO, ROTULO_MOTIVO_ATRASO, atrasoJustificado, haAtrasoParaJustificar, rotuloMotivoAtraso,
} from "@/lib/os/prazo-execucao";

/**
 * ATRASO JUSTIFICADO no cartão "Prazos" da OS. A OS continua atrasada: a justificativa só tira o
 * atraso do desempenho de quem executou.
 *  - justificada: todo mundo que vê a OS lê o motivo, quem marcou e quando;
 *  - "Justificar atraso", "Alterar" e "Desfazer": só quem tem Desempenho › Revisar (o servidor
 *    recusa os demais) — e "Justificar" só aparece quando há atraso (da OS ou de uma atividade).
 */
export function AtrasoJustificado({ os, onAtualizado }: { os: any; onAtualizado: (parcial: any) => void }) {
  const { pode } = usePermissoes();
  const router = useRouter();
  const podeJustificar = pode("desempenho", "revisar");
  const justificada = atrasoJustificado(os);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Abrir começa do que está gravado (ou em branco)
  useEffect(() => {
    if (aberto) { setMotivo(os.atrasoJustificadoMotivo ?? ""); setObservacao(os.atrasoJustificadoObs ?? ""); setErro(""); }
  }, [aberto, os.atrasoJustificadoMotivo, os.atrasoJustificadoObs]);

  async function chamar(metodo: "POST" | "DELETE", corpo?: unknown) {
    const res = await fetch(`/api/ordens/${os.id}/atraso-justificado`, {
      method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const d = await res.json().catch(() => null);
    return { ok: res.ok, d, erro: (d && typeof d.erro === "string" && d.erro) || "" };
  }

  async function salvar() {
    if (!motivo) { setErro("Escolha o motivo do atraso."); return; }
    if (motivo === "OUTRO" && !observacao.trim()) { setErro(MSG_ATRASO_OUTRO); return; }
    setErro(""); setSalvando(true);
    try {
      const r = await chamar("POST", { motivo, observacao });
      // Recusado (sem permissão, sem atraso): a gaveta fica aberta com o que foi escolhido
      if (!r.ok) { setErro(r.erro || "Não foi possível justificar o atraso."); return; }
      toast(justificada ? "Justificativa alterada." : "Atraso justificado.");
      onAtualizado(r.d);
      router.refresh(); // o histórico da OS ganha a linha nova
      setAberto(false);
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  async function desfazer() {
    const sim = await confirmar({
      titulo: "Desfazer a justificativa?",
      mensagem: "O atraso desta OS volta a contar no desempenho de quem executou.",
      confirmarTexto: "Desfazer", perigo: true,
    });
    if (!sim) return;
    try {
      const r = await chamar("DELETE");
      if (!r.ok) { toast(r.erro || "Não foi possível desfazer a justificativa.", "erro"); return; }
      toast("Justificativa desfeita.");
      onAtualizado(r.d);
      router.refresh();
    } catch { toast("Sem conexão. Tente de novo.", "erro"); }
  }

  const haAtraso = haAtrasoParaJustificar(os);
  if (!justificada && !(podeJustificar && haAtraso)) return null;

  return (
    <div className="pt-2.5 border-t border-surface-border" data-atraso-justificado={justificada ? "sim" : "nao"}>
      {justificada ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Atraso justificado</p>
          <p className="text-sm text-ink" data-motivo-atraso>{rotuloMotivoAtraso(os.atrasoJustificadoMotivo) || os.atrasoJustificadoMotivo}</p>
          {os.atrasoJustificadoObs && <p className="text-sm text-ink-muted whitespace-pre-line break-words" data-obs-atraso>{os.atrasoJustificadoObs}</p>}
          <p className="text-xs text-ink-muted" data-autor-atraso>
            {[os.atrasoJustificadoPor?.nome, os.atrasoJustificadoEm ? formatarData(os.atrasoJustificadoEm) : null].filter(Boolean).join(" · ")}
            {" — não conta no desempenho."}
          </p>
          {podeJustificar && (
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setAberto(true)} className="text-xs font-medium text-acento hover:underline" data-alterar-atraso>Alterar</button>
              <button type="button" onClick={desfazer} className="text-xs font-medium text-ink-muted hover:text-atrasado-texto hover:underline" data-desfazer-atraso>Desfazer</button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAberto(true)} className="text-xs font-medium text-acento hover:underline" data-justificar-atraso>
          Justificar atraso
        </button>
      )}

      <Drawer
        aberto={aberto} onFechar={() => setAberto(false)} titulo={`Justificar o atraso da OS ${os.chamadoNumero ?? os.numero}`}
        rodape={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={salvar} loading={salvando} data-salvar-atraso>Salvar</Button>
          </div>
        }
      >
        <div className="space-y-4" data-gaveta-atraso>
          {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-atraso>{erro}</p>}
          <FormField label="Motivo" required dica="Use quando o atraso não foi culpa de quem executou. A OS continua atrasada; o atraso só deixa de contar no desempenho do colaborador.">
            <Select value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Escolha o motivo" aria-label="Motivo do atraso" data-motivo>
              {MOTIVOS_ATRASO.map((m) => <option key={m} value={m}>{ROTULO_MOTIVO_ATRASO[m]}</option>)}
            </Select>
          </FormField>
          <FormField label="Explicação" required={motivo === "OUTRO"}>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={500} aria-label="Explicação do atraso"
              placeholder={motivo === "OUTRO" ? "O que aconteceu" : "Opcional"} data-observacao />
          </FormField>
        </div>
      </Drawer>
    </div>
  );
}
