"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { AlertCircle, Camera, CheckCircle2, X } from "lucide-react";

interface ItemTpl { id: string; categoria: string; descricao: string; tipo: string; opcoes: string[]; obrigatorio: boolean; ordem: number }
interface Template { id: string; nome: string; frequencia: string; itens: ItemTpl[] }
interface Opt { id: string; placa?: string; modelo?: string; nome?: string }

interface Props {
  veiculos: { id: string; placa: string; modelo: string }[];
  templates: Template[];
  colaboradores: { id: string; nome: string }[];
  veiculoInicial?: string;
}

interface Resposta { valor: string | null; foto: string | null }

export function ChecklistPreenchimento({ veiculos, templates, colaboradores, veiculoInicial }: Props) {
  const router = useRouter();
  const [veiculoId, setVeiculoId] = useState(veiculoInicial && veiculos.some((v) => v.id === veiculoInicial) ? veiculoInicial : "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [colaboradorId, setColaboradorId] = useState("");
  const [respostas, setRespostas] = useState<Record<string, Resposta>>({});
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState<null | "CONCLUIDO" | "COM_ALERTAS">(null);

  const fotoRef = useRef<HTMLInputElement>(null);
  const fotoItem = useRef<string | null>(null);

  const template = templates.find((t) => t.id === templateId);

  const categorias = useMemo(() => {
    if (!template) return [];
    const map = new Map<string, ItemTpl[]>();
    for (const it of template.itens) {
      if (!map.has(it.categoria)) map.set(it.categoria, []);
      map.get(it.categoria)!.push(it);
    }
    return Array.from(map.entries());
  }, [template]);

  function setValor(item: ItemTpl, valor: string) {
    setRespostas((p) => ({ ...p, [item.id]: { valor, foto: p[item.id]?.foto ?? null } }));
  }
  function setTexto(itemId: string, valor: string) {
    setRespostas((p) => ({ ...p, [itemId]: { valor, foto: p[itemId]?.foto ?? null } }));
  }
  function escolherFoto(itemId: string) { fotoItem.current = itemId; fotoRef.current?.click(); }
  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; const itemId = fotoItem.current;
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file || !itemId) return;
    if (file.size > 3 * 1024 * 1024) { setErro("Foto muito grande. Máximo 3 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => setRespostas((p) => ({ ...p, [itemId]: { valor: p[itemId]?.valor ?? null, foto: typeof reader.result === "string" ? reader.result : null } }));
    reader.readAsDataURL(file);
  }

  // Um item gera alerta quando o valor não é a primeira opção (estado saudável)
  function itemAlerta(item: ItemTpl, valor: string | null): boolean {
    if (!valor) return false;
    if (item.tipo === "OK_NOK" || item.tipo === "NIVEL") {
      return item.opcoes.length > 0 && valor !== item.opcoes[0];
    }
    return false;
  }

  async function enviar() {
    setErro("");
    if (!veiculoId) { setErro("Selecione o veículo."); return; }
    if (!template) { setErro("Selecione o template."); return; }
    // valida obrigatórios
    for (const it of template.itens) {
      if (!it.obrigatorio) continue;
      const r = respostas[it.id];
      if (it.tipo === "FOTO") { if (!r?.foto) { setErro(`Anexe a foto: ${it.descricao}`); return; } }
      else if (!r?.valor) { setErro(`Preencha: ${it.descricao}`); return; }
    }
    setSalvando(true);
    const itens = template.itens.map((it) => {
      const r = respostas[it.id];
      return {
        itemTemplateId: it.id,
        valor: r?.valor ?? null,
        foto: r?.foto ?? null,
        alerta: itemAlerta(it, r?.valor ?? null),
      };
    });
    try {
      const res = await fetch("/api/checklists", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, templateId, colaboradorId, observacaoGeral, itens }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao enviar checklist."); return; }
      const data = await res.json();
      setConcluido(data.temAlerta ? "COM_ALERTAS" : "CONCLUIDO");
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  if (concluido) {
    return (
      <div className="bg-white rounded-2xl shadow-card border border-surface-border p-8 text-center space-y-4">
        <div className={cn("w-16 h-16 rounded-full mx-auto flex items-center justify-center", concluido === "COM_ALERTAS" ? "bg-amber-50" : "bg-success-50")}>
          {concluido === "COM_ALERTAS" ? <AlertCircle className="w-8 h-8 text-amber-600" /> : <CheckCircle2 className="w-8 h-8 text-success-600" />}
        </div>
        <div>
          <h3 className="text-lg font-bold text-ink">{concluido === "COM_ALERTAS" ? "Checklist enviado com alertas" : "Checklist concluído"}</h3>
          <p className="text-sm text-ink-muted mt-1">
            {concluido === "COM_ALERTAS" ? "Itens com problema foram registrados e o gestor será notificado." : "Nenhuma irregularidade encontrada. Bom trabalho!"}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button type="button" variant="secondary" onClick={() => { setConcluido(null); setRespostas({}); setObservacaoGeral(""); }}>Novo checklist</Button>
          <Button type="button" onClick={() => router.push("/veiculos")}>Voltar para veículos</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {erro && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
        </div>
      )}
      <input ref={fotoRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />

      <div className="bg-white rounded-2xl shadow-card border border-surface-border p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 gap-3">
          <FormField label="Veículo" required>
            <Select value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
              <option value="">Selecione…</option>
              {veiculos.map((v) => <option key={v.id} value={v.id}>{v.placa} — {v.modelo}</option>)}
            </Select>
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Modelo de checklist" required>
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.length === 0 && <option value="">Nenhum template ativo</option>}
                {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </Select>
            </FormField>
            <FormField label="Colaborador">
              <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
                <option value="">Selecione…</option>
                {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </FormField>
          </div>
        </div>
      </div>

      {template && categorias.map(([categoria, itens]) => (
        <div key={categoria} className="bg-white rounded-2xl shadow-card border border-surface-border overflow-hidden">
          <div className="px-4 py-2.5 bg-surface-alt border-b border-surface-border">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">{categoria}</p>
          </div>
          <div className="divide-y divide-surface-border">
            {itens.map((it) => {
              const r = respostas[it.id];
              const alerta = itemAlerta(it, r?.valor ?? null);
              return (
                <div key={it.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{it.descricao}{it.obrigatorio && <span className="text-red-500 ml-0.5">*</span>}</p>
                    {alerta && <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">Alerta</span>}
                  </div>

                  {(it.tipo === "OK_NOK" || it.tipo === "NIVEL") && (
                    <div className="flex flex-wrap gap-2">
                      {it.opcoes.map((op, idx) => {
                        const sel = r?.valor === op;
                        const ehSaudavel = idx === 0;
                        return (
                          <button key={op} type="button" onClick={() => setValor(it, op)}
                            className={cn(
                              "px-3 py-2 rounded-lg text-sm font-medium border transition-colors",
                              sel
                                ? ehSaudavel ? "bg-success-500 border-success-500 text-white" : "bg-amber-500 border-amber-500 text-white"
                                : "bg-white border-surface-border text-ink-muted hover:border-primary-300",
                            )}>
                            {op}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {it.tipo === "TEXTO" && (
                    <Textarea value={r?.valor ?? ""} onChange={(e) => setTexto(it.id, e.target.value)} rows={2} placeholder="Descreva…" />
                  )}

                  {it.tipo === "FOTO" && (
                    <div className="flex items-center gap-3">
                      {r?.foto && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.foto} alt={it.descricao} className="w-16 h-16 rounded-lg object-cover border border-surface-border" />
                      )}
                      <Button type="button" variant="secondary" onClick={() => escolherFoto(it.id)} className="text-xs py-1.5 px-3 h-auto">
                        <Camera className="w-4 h-4" /> {r?.foto ? "Trocar foto" : "Tirar foto"}
                      </Button>
                      {r?.foto && (
                        <button type="button" onClick={() => setRespostas((p) => ({ ...p, [it.id]: { valor: p[it.id]?.valor ?? null, foto: null } }))} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {template && (
        <div className="bg-white rounded-2xl shadow-card border border-surface-border p-4 sm:p-6 space-y-4">
          <FormField label="Observação geral">
            <Textarea value={observacaoGeral} onChange={(e) => setObservacaoGeral(e.target.value)} rows={3} placeholder="Observações sobre o veículo…" />
          </FormField>
          <Button type="button" loading={salvando} onClick={enviar} className="w-full justify-center">Enviar checklist</Button>
        </div>
      )}
    </div>
  );
}
