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
  AJUDA_RESPONSABILIDADE_ATRASO, MOTIVOS_ATRASO, MSG_ATRASO_OUTRO, MSG_ATRASO_SEM_RESPONSAVEL, RESPONSABILIDADES_ATRASO,
  RESPONSABILIDADE_SUGERIDA, ROTULO_MOTIVO_ATRASO, ROTULO_RESPONSABILIDADE_ATRASO, atrasoJustificado, avisoMesFechado,
  explicacaoDoAtrasoValida, rotuloMotivoAtraso, rotuloResponsabilidadeAtraso, type MotivoAtraso,
} from "@/lib/os/prazo-execucao";
import { haDescumprimentoParaJustificar } from "@/lib/prazos/cumprimento";

/**
 * ATRASO JUSTIFICADO no cartão "Prazos" da OS. A OS continua atrasada: a justificativa só tira o
 * atraso do desempenho de quem executou (lib/desempenho/regras › medirAtividades) — e, se o mês do
 * atraso já fechou, avisa que o escore daquele mês não muda.
 *  - justificada: todo mundo que vê a OS lê o motivo, de quem foi a causa, quem marcou e quando;
 *  - "Justificar atraso", "Alterar" e "Desfazer": só quem tem Desempenho › Revisar (o servidor
 *    recusa os demais) — e "Justificar" só aparece quando há prazo descumprido (comparecer, resolver
 *    ou execução) ou atividade atrasada.
 *
 * DE QUEM FOI A CAUSA: o motivo pré-seleciona uma sugestão, mas quem decide é o gestor — é a escolha
 * dele que é gravada, e é ela (não o texto livre) que o relatório do cliente lê para pausar o SLA.
 */
export function AtrasoJustificado({ os, onAtualizado }: { os: any; onAtualizado: (parcial: any) => void }) {
  const { pode } = usePermissoes();
  const router = useRouter();
  const podeJustificar = pode("desempenho", "revisar");
  const justificada = atrasoJustificado(os);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Abrir começa do que está gravado (ou em branco)
  useEffect(() => {
    if (aberto) {
      setMotivo(os.atrasoJustificadoMotivo ?? ""); setResponsavel(os.atrasoResponsavel ?? "");
      setObservacao(os.atrasoJustificadoObs ?? ""); setErro("");
    }
  }, [aberto, os.atrasoJustificadoMotivo, os.atrasoResponsavel, os.atrasoJustificadoObs]);

  /**
   * Trocar o motivo sugere a causa — e só sugere: fica à vista, o gestor confirma ou troca. Motivo
   * sem sugestão (peça faltando, outro) LIMPA o campo: deixar ali a sugestão do motivo anterior
   * faria o gestor salvar sem olhar uma causa que ninguém escolheu para este motivo.
   */
  function escolherMotivo(novo: string) {
    setMotivo(novo);
    setResponsavel(RESPONSABILIDADE_SUGERIDA[novo as MotivoAtraso] ?? "");
  }

  async function chamar(metodo: "POST" | "DELETE", corpo?: unknown) {
    const res = await fetch(`/api/ordens/${os.id}/atraso-justificado`, {
      method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const d = await res.json().catch(() => null);
    return { ok: res.ok, d, erro: (d && typeof d.erro === "string" && d.erro) || "" };
  }

  async function salvar() {
    if (!motivo) { setErro("Escolha o motivo do atraso."); return; }
    if (!responsavel) { setErro(MSG_ATRASO_SEM_RESPONSAVEL); return; }
    if (!explicacaoDoAtrasoValida(motivo, observacao)) { setErro(MSG_ATRASO_OUTRO); return; }
    setErro(""); setSalvando(true);
    try {
      const r = await chamar("POST", { motivo, responsavel, observacao });
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

  const haAtraso = haDescumprimentoParaJustificar(os);
  // Mês do desempenho já fechado: a justificativa fica gravada, mas não muda o escore daquele mês
  const mesFechado = podeJustificar ? avisoMesFechado(os.mesesFechadosDoAtraso) : "";
  if (!justificada && !(podeJustificar && haAtraso)) return null;

  return (
    <div className="pt-2.5 border-t border-surface-border" data-atraso-justificado={justificada ? "sim" : "nao"}>
      {justificada ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Atraso justificado</p>
          <p className="text-sm text-ink" data-motivo-atraso>
            {rotuloMotivoAtraso(os.atrasoJustificadoMotivo) || os.atrasoJustificadoMotivo}
            {os.atrasoResponsavel && <span className="text-ink-muted" data-responsavel-atraso={os.atrasoResponsavel}> · {rotuloResponsabilidadeAtraso(os.atrasoResponsavel)}</span>}
          </p>
          {os.atrasoJustificadoObs && <p className="text-sm text-ink-muted whitespace-pre-line break-words" data-obs-atraso>{os.atrasoJustificadoObs}</p>}
          <p className="text-xs text-ink-muted" data-autor-atraso>
            {[os.atrasoJustificadoPor?.nome, os.atrasoJustificadoEm ? formatarData(os.atrasoJustificadoEm) : null].filter(Boolean).join(" · ")}
            {" — não conta no desempenho."}
          </p>
          {mesFechado && <p className="text-xs text-atencao-texto" data-aviso-mes-fechado>{mesFechado}</p>}
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
        aberto={aberto} onFechar={() => setAberto(false)} titulo={`Justificar atraso · ${os.chamadoNumero ?? os.numero}`}
        rodape={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={salvar} loading={salvando} data-salvar-atraso>Salvar</Button>
          </div>
        }
      >
        <div className="space-y-4" data-gaveta-atraso>
          {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-atraso>{erro}</p>}
          {mesFechado && <p className="text-sm text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2" data-aviso-mes-fechado>{mesFechado}</p>}
          <FormField label="Motivo" required dica="Use quando o atraso não foi culpa de quem executou. A OS continua atrasada; o atraso só deixa de contar no desempenho do colaborador.">
            <Select value={motivo} onChange={(e) => escolherMotivo(e.target.value)} placeholder="Escolha o motivo" aria-label="Motivo do atraso" data-motivo>
              {MOTIVOS_ATRASO.map((m) => <option key={m} value={m}>{ROTULO_MOTIVO_ATRASO[m]}</option>)}
            </Select>
          </FormField>
          <FormField label="De quem foi a causa" required dica="É esta marcação que o relatório do cliente lê: o atraso por causa dele sai da conta do percentual que ele recebe. Causa interna e força maior continuam contando como descumprido no documento que vai a ele.">
            <Select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Escolha a causa" aria-label="De quem foi a causa do atraso" data-responsavel>
              {RESPONSABILIDADES_ATRASO.map((r) => <option key={r} value={r}>{ROTULO_RESPONSABILIDADE_ATRASO[r]}</option>)}
            </Select>
          </FormField>
          {responsavel && (
            <p className="-mt-2 text-xs text-ink-muted" data-ajuda-responsavel>
              {AJUDA_RESPONSABILIDADE_ATRASO[responsavel as keyof typeof AJUDA_RESPONSABILIDADE_ATRASO]}
            </p>
          )}
          <FormField label="Explicação" required={motivo === "OUTRO"}>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={500} aria-label="Explicação do atraso"
              placeholder={motivo === "OUTRO" ? "O que aconteceu" : "Opcional"} data-observacao />
          </FormField>
        </div>
      </Drawer>
    </div>
  );
}
