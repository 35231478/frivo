"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/avisos";
import { ItensChecklist } from "@/components/veiculos/itens-checklist";
import { itemGeraAlerta, primeiroObrigatorioFaltando, type ItemDoModelo, type RespostaDoItem } from "@/lib/veiculos/checklist";

interface Modelo { id: string; nome: string; frequencia: string; itens: ItemDoModelo[] }

interface Props {
  veiculos: { id: string; placa: string; modelo: string }[];
  templates: Modelo[];
  colaboradores: { id: string; nome: string }[];
  veiculoInicial?: string;
  /** Chamado depois de enviar (a tela usa para oferecer "Ver preenchidos") */
  onVerPreenchidos?: () => void;
}

/** Preencher o checklist de um veículo. Os itens são o mesmo bloco do detalhe e da edição. */
export function ChecklistPreenchimento({ veiculos, templates, colaboradores, veiculoInicial, onVerPreenchidos }: Props) {
  const router = useRouter();
  const [veiculoId, setVeiculoId] = useState(veiculoInicial && veiculos.some((v) => v.id === veiculoInicial) ? veiculoInicial : "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [colaboradorId, setColaboradorId] = useState("");
  const [respostas, setRespostas] = useState<Record<string, RespostaDoItem>>({});
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState<null | "CONCLUIDO" | "COM_ALERTAS">(null);

  const modelo = templates.find((t) => t.id === templateId);

  async function enviar() {
    setErro("");
    if (!veiculoId) { setErro("Selecione o veículo."); return; }
    if (!modelo) { setErro("Selecione o modelo de checklist."); return; }
    const falta = primeiroObrigatorioFaltando(modelo.itens, respostas);
    if (falta) { setErro(falta); return; }
    setSalvando(true);
    const itens = modelo.itens.map((it) => {
      const r = respostas[it.id];
      return { itemTemplateId: it.id, valor: r?.valor ?? null, foto: r?.foto ?? null, alerta: itemGeraAlerta(it, r?.valor ?? null) };
    });
    try {
      const res = await fetch("/api/checklists", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, templateId, colaboradorId, observacaoGeral, itens }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setErro((data && typeof data.erro === "string" && data.erro) || "Não foi possível enviar o checklist."); return; }
      toast("Checklist enviado.");
      setConcluido(data?.temAlerta ? "COM_ALERTAS" : "CONCLUIDO");
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  if (concluido) {
    return (
      <div className="bg-white rounded-card shadow-card border border-surface-border p-8 text-center space-y-4" data-checklist-enviado={concluido}>
        <div className={cn("w-16 h-16 rounded-full mx-auto flex items-center justify-center", concluido === "COM_ALERTAS" ? "bg-atencao-claro" : "bg-success-50")}>
          {concluido === "COM_ALERTAS" ? <AlertCircle className="w-8 h-8 text-atencao-texto" aria-hidden /> : <CheckCircle2 className="w-8 h-8 text-success-600" aria-hidden />}
        </div>
        <div>
          <h3 className="text-lg font-bold text-ink">{concluido === "COM_ALERTAS" ? "Checklist enviado com alertas" : "Checklist concluído"}</h3>
          <p className="text-sm text-ink-muted mt-1">
            {concluido === "COM_ALERTAS" ? "Itens com problema foram registrados e o gestor será notificado." : "Nenhuma irregularidade registrada."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button type="button" variant="secondary" onClick={() => { setConcluido(null); setRespostas({}); setObservacaoGeral(""); }}>Novo checklist</Button>
          {onVerPreenchidos
            ? <Button type="button" onClick={onVerPreenchidos} data-ver-preenchidos>Ver preenchidos</Button>
            : <Button type="button" onClick={() => router.push("/veiculos")}>Voltar para veículos</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-checklist-preenchimento>
      {erro && (
        <div role="alert" className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-erro-checklist>
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
        </div>
      )}

      <div className="bg-white rounded-card shadow-card border border-surface-border p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 gap-3">
          <FormField label="Veículo" required>
            <Select value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)} data-veiculo-checklist>
              <option value="">Selecione</option>
              {veiculos.map((v) => <option key={v.id} value={v.id}>{v.placa} — {v.modelo}</option>)}
            </Select>
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Modelo de checklist" required>
              <Select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setRespostas({}); }} data-modelo-checklist>
                {templates.length === 0 && <option value="">Nenhum modelo ativo</option>}
                {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </Select>
            </FormField>
            <FormField label="Colaborador">
              <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)} data-colaborador-checklist>
                <option value="">Selecione</option>
                {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </FormField>
          </div>
        </div>
      </div>

      {modelo && (
        <ItensChecklist
          itens={modelo.itens} respostas={respostas} onErro={setErro}
          onResposta={(itemId, r) => setRespostas((p) => ({ ...p, [itemId]: r }))}
        />
      )}

      {modelo && (
        <div className="bg-white rounded-card shadow-card border border-surface-border p-4 sm:p-6 space-y-4">
          <FormField label="Observação geral">
            <Textarea value={observacaoGeral} onChange={(e) => setObservacaoGeral(e.target.value)} rows={3} placeholder="Observações sobre o veículo" />
          </FormField>
          <Button type="button" loading={salvando} onClick={enviar} className="w-full justify-center" data-enviar-checklist>Enviar checklist</Button>
        </div>
      )}
    </div>
  );
}
