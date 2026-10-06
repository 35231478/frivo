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
import { Modal } from "@/components/ui/modal";
import { AlertCircle, AlertTriangle, Check, Truck } from "lucide-react";

interface Colab { id: string; nome: string; avatar?: string | null }
interface VeiculoOpt { id: string; placa: string; modelo: string; equipe: { id: string; nome: string } | null; inativo: boolean }

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
  // Todos os veículos da equipe (antes só 1 — salvar desvinculava os demais sem avisar)
  const vinculadosAntes: string[] = initialData?.veiculos?.map((v: any) => v.id) ?? [];
  const [veiculoIds, setVeiculoIds] = useState<string[]>(vinculadosAntes);
  const [confirmar, setConfirmar] = useState<string[] | null>(null);
  const [status, setStatus] = useState(initialData?.status ?? "ATIVA");
  const [observacoes, setObservacoes] = useState(initialData?.observacoes ?? "");

  const [colaboradores, setColaboradores] = useState<Colab[]>([]);
  const [veiculos, setVeiculos] = useState<VeiculoOpt[]>([]);

  useEffect(() => {
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setColaboradores(Array.isArray(d) ? d : [])).catch(() => {});
    // Só veículos ativos; os já vinculados continuam aparecendo mesmo se tiverem sido inativados
    fetch("/api/veiculos").then((r) => r.json()).then((d) => setVeiculos(Array.isArray(d)
      ? d.filter((v: any) => v.status !== "INATIVO" || vinculadosAntes.includes(v.id))
        .map((v: any) => ({ id: v.id, placa: v.placa, modelo: v.modelo, equipe: v.equipe ? { id: v.equipe.id, nome: v.equipe.nome } : null, inativo: v.status === "INATIVO" }))
      : [])).catch(() => {});
  }, []);

  function toggleMembro(id: string) {
    setMembroIds((p) => (p.includes(id) ? p.filter((m) => m !== id) : [...p, id]));
  }

  function toggleVeiculo(id: string) {
    setVeiculoIds((p) => (p.includes(id) ? p.filter((v) => v !== id) : [...p, id]));
  }
  const saindo = veiculos.filter((v) => vinculadosAntes.includes(v.id) && !veiculoIds.includes(v.id));
  const vindoDeOutra = veiculos.filter((v) => veiculoIds.includes(v.id) && v.equipe && v.equipe.id !== initialData?.id);

  async function salvar(confirmarDesvinculo = false) {
    setErro("");
    if (!nome.trim()) { setErro("Nome da equipe é obrigatório."); return; }
    // Desvincular veículo nunca acontece sem a pessoa confirmar
    if (saindo.length && !confirmarDesvinculo) { setConfirmar(saindo.map((v) => v.placa)); return; }
    setSalvando(true);
    try {
      const url = isEditing ? `/api/equipes/${initialData.id}` : "/api/equipes";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, cor, liderId: liderId || null, membroIds, veiculoIds, confirmarDesvinculo, status, observacoes }),
      });
      const e = await res.json().catch(() => ({}));
      if (res.status === 409 && e.requerConfirmacao) { setConfirmar(e.desvincular ?? []); return; }
      if (!res.ok) { setErro(e.erro ?? "Erro ao salvar equipe."); return; }
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
          </FormGrid>

          <FormField label="Veículos da equipe" hint="Marque todos os veículos que ficam com esta equipe">
            {veiculos.length === 0 ? (
              <p className="text-sm text-ink-subtle">Nenhum veículo cadastrado.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-veiculos-equipe>
                {veiculos.map((v) => {
                  const sel = veiculoIds.includes(v.id);
                  const outra = v.equipe && v.equipe.id !== initialData?.id ? v.equipe.nome : null;
                  return (
                    <label key={v.id} className={cn("flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                      sel ? "border-primary-300 bg-primary-50" : "border-surface-border hover:bg-surface-alt")}>
                      <input type="checkbox" checked={sel} onChange={() => toggleVeiculo(v.id)} aria-label={`Veículo ${v.placa}`}
                        className="w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                      <Truck className="w-4 h-4 text-ink-subtle shrink-0" />
                      <span className="text-sm text-ink truncate"><span className="font-mono font-semibold">{v.placa}</span> — {v.modelo}{v.inativo ? " (inativo)" : ""}</span>
                      {outra && <span className="ml-auto text-[10px] text-ink-muted bg-surface-alt px-1.5 py-0.5 rounded shrink-0">{outra}</span>}
                    </label>
                  );
                })}
              </div>
            )}
            {(saindo.length > 0 || vindoDeOutra.length > 0) && (
              <div data-aviso-veiculos className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
                {saindo.length > 0 && <p className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Ao salvar, {saindo.map((v) => v.placa).join(", ")} {saindo.length === 1 ? "será desvinculado" : "serão desvinculados"} desta equipe.</p>}
                {vindoDeOutra.length > 0 && <p className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {vindoDeOutra.map((v) => `${v.placa} sai da equipe ${v.equipe!.nome}`).join("; ")} e passa para esta.</p>}
              </div>
            )}
          </FormField>

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
        <Button type="button" loading={salvando} onClick={() => salvar()}><Check className="w-4 h-4" /> {isEditing ? "Salvar alterações" : "Cadastrar equipe"}</Button>
      </div>

      <Modal aberto={!!confirmar} onFechar={() => setConfirmar(null)} titulo="Desvincular veículo?" tamanho="sm">
        <div className="space-y-4" data-confirmar-desvinculo>
          <p className="text-sm text-ink">
            Ao salvar, {confirmar?.length === 1 ? "o veículo" : "os veículos"} <strong>{confirmar?.join(", ")}</strong> {confirmar?.length === 1 ? "deixa" : "deixam"} de estar vinculado{confirmar && confirmar.length > 1 ? "s" : ""} a esta equipe.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmar(null)}>Voltar</Button>
            <Button type="button" loading={salvando} onClick={() => { setConfirmar(null); salvar(true); }}>Sim, desvincular e salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
