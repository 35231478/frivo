"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { InputData } from "@/components/ui/input-data";
import { toast } from "@/components/ui/avisos";
import { camposAlterados } from "@/lib/edicao-contexto";
import { LABELS_PRIORIDADE } from "@/lib/utils";

/** Os campos PRÓPRIOS da OS (o resto da central edita o que é de cada aba). */
const CAMPOS = ["responsavelId", "previsaoConclusao", "prioridade", "descricao", "observacoes"] as const;
type Campo = (typeof CAMPOS)[number];

const soData = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");

/**
 * Gaveta "Editar OS": os campos da própria OS (responsável, previsão, prioridade, descrição e
 * observações) — até a Leva 5 o botão Editar do cabeçalho levava a uma rota que só voltava para cá,
 * e não havia tela nenhuma para esses campos.
 *
 * Manda só o que mudou, para o mesmo PUT /api/ordens/[id] que o resto da central usa (Ordens ›
 * editar; o servidor recusa quem não tem). Registro fechado (OS assinada, faturada ou com nota) não
 * abre: o cabeçalho mostra o cadeado com o motivo, e o servidor recusa de qualquer jeito.
 */
export function EditarOs({ os, aberto, onFechar, onAtualizado }: {
  os: any;
  aberto: boolean;
  onFechar: () => void;
  onAtualizado: (os: any) => void;
}) {
  const [usuarios, setUsuarios] = useState<{ id: string; nome: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const inicial = (): Record<Campo, string> => ({
    responsavelId: os.responsavelId ?? "",
    previsaoConclusao: soData(os.previsaoConclusao),
    prioridade: os.prioridade ?? "NORMAL",
    descricao: os.descricao ?? "",
    observacoes: os.observacoes ?? "",
  });
  const [form, setForm] = useState<Record<Campo, string>>(inicial);
  const upd = (c: Campo, v: string) => setForm((f) => ({ ...f, [c]: v }));

  // Reabrir a gaveta começa do que está gravado (descarta o rascunho de uma edição cancelada)
  useEffect(() => { if (aberto) { setForm(inicial()); setErro(""); } }, [aberto, os]);
  useEffect(() => {
    if (!aberto || usuarios.length) return;
    fetch("/api/usuarios", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((l) => setUsuarios(Array.isArray(l) ? l : [])).catch(() => {});
  }, [aberto, usuarios.length]);

  async function salvar() {
    if (!form.descricao.trim()) { setErro("Descreva o serviço da OS."); return; }
    const alterados = camposAlterados(inicial(), form, CAMPOS);
    if (!alterados.length) { onFechar(); return; }
    setErro(""); setSalvando(true);
    try {
      const corpo = Object.fromEntries(alterados.map((c) => [c, form[c as Campo] || null]));
      const res = await fetch(`/api/ordens/${os.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await res.json().catch(() => null);
      // Recusado (sem permissão, registro fechado): a gaveta fica aberta com o que foi digitado
      if (!res.ok) { setErro((d && typeof d.erro === "string" && d.erro) || "Não foi possível salvar a OS."); return; }
      toast("OS salva.");
      onAtualizado(d);
      onFechar();
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar} titulo={`Editar a OS ${os.chamadoNumero ?? os.numero}`}
      rodape={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando} data-salvar-os>Salvar</Button>
        </div>
      }
    >
      <div className="space-y-4" data-editar-os>
        {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-os>{erro}</p>}
        <FormGrid>
          <FormField label="Responsável" dica="Quem responde pela OS no escritório. O cadastro de usuários fica em Configurações › Usuários (criar um dá acesso ao sistema).">
            <Select value={form.responsavelId} onChange={(e) => upd("responsavelId", e.target.value)} placeholder="Sem responsável" data-responsavel-os>
              {[...usuarios, ...(os.responsavel && !usuarios.some((u) => u.id === os.responsavelId) ? [{ id: os.responsavelId, nome: os.responsavel.nome }] : [])]
                .map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </Select>
          </FormField>
          <FormField label="Previsão de conclusão">
            <InputData value={form.previsaoConclusao} onChange={(v) => upd("previsaoConclusao", v)} />
          </FormField>
        </FormGrid>
        <FormField label="Prioridade">
          <Select value={form.prioridade} onChange={(e) => upd("prioridade", e.target.value)} className="sm:max-w-xs" data-prioridade-os>
            {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
        <FormField label="Descrição" required>
          <Textarea value={form.descricao} onChange={(e) => upd("descricao", e.target.value)} rows={3} data-descricao-os />
        </FormField>
        <FormField label="Observações">
          <Textarea value={form.observacoes} onChange={(e) => upd("observacoes", e.target.value)} rows={2} data-observacoes-os />
        </FormField>
      </div>
    </Drawer>
  );
}
