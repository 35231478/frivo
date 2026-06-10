"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { AlertCircle, Check } from "lucide-react";

interface Colab { id: string; nome: string; avatar?: string | null }
interface VeiculoOpt { id: string; placa: string; modelo: string }

const CORES = ["#0EA5E9", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#EC4899", "#06B6D4", "#6366F1"];

export function EquipeForm({ initialData }: { initialData?: any }) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState(initialData?.nome ?? "");
  const [cor, setCor] = useState(initialData?.cor ?? "#0EA5E9");
  const [liderId, setLiderId] = useState(initialData?.liderId ?? "");
  const [membroIds, setMembroIds] = useState<string[]>(initialData?.membros?.map((m: any) => m.id) ?? []);
  const [veiculoId, setVeiculoId] = useState<string>(initialData?.veiculos?.[0]?.id ?? "");
  const [status, setStatus] = useState(initialData?.status ?? "ATIVA");
  const [observacoes, setObservacoes] = useState(initialData?.observacoes ?? "");

  const [colaboradores, setColaboradores] = useState<Colab[]>([]);
  const [veiculos, setVeiculos] = useState<VeiculoOpt[]>([]);

  useEffect(() => {
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setColaboradores(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/veiculos").then((r) => r.json()).then((d) => setVeiculos(Array.isArray(d) ? d.map((v: any) => ({ id: v.id, placa: v.placa, modelo: v.modelo })) : [])).catch(() => {});
  }, []);

  function toggleMembro(id: string) {
    setMembroIds((p) => (p.includes(id) ? p.filter((m) => m !== id) : [...p, id]));
  }

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Nome da equipe é obrigatório."); return; }
    setSalvando(true);
    try {
      const url = isEditing ? `/api/equipes/${initialData.id}` : "/api/equipes";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, cor, liderId: liderId || null, membroIds, veiculoId: veiculoId || null, status, observacoes }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar equipe."); return; }
      router.push("/equipes");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-5">
      {erro && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-surface-border p-5 sm:p-6 lg:p-8 space-y-8">
        <FormSection title="Identificação">
          <FormGrid>
            <FormField label="Nome da equipe" required>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Equipe Norte" />
            </FormField>
            <FormField label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="ATIVA">Ativa</option>
                <option value="INATIVA">Inativa</option>
              </Select>
            </FormField>
          </FormGrid>
          <FormField label="Cor de identificação" hint="Usada para destacar a equipe no calendário">
            <div className="flex items-center gap-2 flex-wrap">
              {CORES.map((c) => (
                <button key={c} type="button" onClick={() => setCor(c)}
                  className={cn("w-8 h-8 rounded-full border-2 transition-transform", cor === c ? "border-ink scale-110" : "border-white shadow-sm")}
                  style={{ backgroundColor: c }} aria-label={c} />
              ))}
              <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-surface-border" />
            </div>
          </FormField>
        </FormSection>

        <FormSection title="Composição">
          <FormGrid>
            <FormField label="Líder da equipe">
              <Select value={liderId} onChange={(e) => setLiderId(e.target.value)}>
                <option value="">Selecione…</option>
                {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </FormField>
            <FormField label="Veículo vinculado">
              <Select value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
                <option value="">Nenhum</option>
                {veiculos.map((v) => <option key={v.id} value={v.id}>{v.placa} — {v.modelo}</option>)}
              </Select>
            </FormField>
          </FormGrid>

          <FormField label="Membros" hint="Selecione os colaboradores que compõem a equipe">
            {colaboradores.length === 0 ? (
              <p className="text-sm text-ink-subtle">Nenhum colaborador cadastrado.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {colaboradores.map((c) => {
                  const sel = membroIds.includes(c.id);
                  return (
                    <label key={c.id} className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                      sel ? "border-primary-300 bg-primary-50" : "border-surface-border hover:bg-surface-alt",
                    )}>
                      <input type="checkbox" checked={sel} onChange={() => toggleMembro(c.id)}
                        className="w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                      <AvatarTecnico nome={c.nome} fotoUrl={c.avatar} size={28} />
                      <span className="text-sm text-ink truncate">{c.nome}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </FormField>
        </FormSection>

        <FormSection title="Observações">
          <FormField label="Observações"><Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} /></FormField>
        </FormSection>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {isEditing ? "Salvar alterações" : "Cadastrar equipe"}</Button>
      </div>
    </div>
  );
}
