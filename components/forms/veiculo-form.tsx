"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { GaleriaImagens } from "@/components/ui/galeria-imagens";
import {
  Truck, UserCog, FileText, Wrench, ClipboardCheck, AlertCircle, Plus, Trash2, Upload, X,
} from "lucide-react";

type Aba = "identificacao" | "responsavel" | "documentos" | "manutencoes" | "checklists";

const TIPOS_VEICULO = [
  { v: "CARRO", l: "Carro" }, { v: "VAN", l: "Van" }, { v: "MOTO", l: "Moto" },
  { v: "CAMINHAO", l: "Caminhão" }, { v: "OUTRO", l: "Outro" },
];
const STATUS_VEICULO = [
  { v: "ATIVO", l: "Ativo" }, { v: "INATIVO", l: "Inativo" }, { v: "MANUTENCAO", l: "Em manutenção" },
];
const TIPOS_DOC_VEICULO = [
  { v: "CRLV", l: "CRLV" }, { v: "SEGURO", l: "Seguro" }, { v: "IPVA", l: "IPVA" },
  { v: "CNH_MOTORISTA", l: "CNH do Motorista" }, { v: "OUTRO", l: "Outro" },
];
const TIPOS_MANUT = [
  { v: "PREVENTIVA", l: "Preventiva" }, { v: "CORRETIVA", l: "Corretiva" }, { v: "REVISAO", l: "Revisão" },
];

interface Opt { id: string; nome: string }
interface DocItem { tipo: string; nome: string; arquivoUrl: string | null; dataVencimento: string | null }

function formatarPlaca(v: string): string {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  if (s.length >= 5 && /[A-Z]/.test(s[4])) return s; // Mercosul (LLLNLNN)
  if (s.length > 3) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return s;
}

export function VeiculoForm({ initialData, ocorrencias }: { initialData?: any; ocorrencias?: { descricao: string; count: number }[] }) {
  const router = useRouter();
  const isEditing = !!initialData;
  const veiculoId = initialData?.id as string | undefined;

  const [aba, setAba] = useState<Aba>("identificacao");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [fotos, setFotos] = useState<string[]>(initialData?.fotos ?? []);
  const [form, setForm] = useState({
    placa: initialData?.placa ?? "",
    marca: initialData?.marca ?? "",
    modelo: initialData?.modelo ?? "",
    ano: initialData?.ano ?? "",
    cor: initialData?.cor ?? "",
    tipo: initialData?.tipo ?? "CARRO",
    chassi: initialData?.chassi ?? "",
    renavam: initialData?.renavam ?? "",
    status: initialData?.status ?? "ATIVO",
    observacoes: initialData?.observacoes ?? "",
    responsavelId: initialData?.responsavelId ?? "",
    equipeId: initialData?.equipeId ?? "",
    quilometragemAtual: initialData?.quilometragemAtual?.toString() ?? "",
    proximaRevisaoKm: initialData?.proximaRevisaoKm?.toString() ?? "",
    proximaRevisaoData: initialData?.proximaRevisaoData ? String(initialData.proximaRevisaoData).slice(0, 10) : "",
    seguroVencimento: initialData?.seguroVencimento ? String(initialData.seguroVencimento).slice(0, 10) : "",
  });
  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [documentos, setDocumentos] = useState<DocItem[]>(
    (initialData?.documentos ?? []).map((d: any) => ({
      tipo: d.tipo, nome: d.nome, arquivoUrl: d.arquivoUrl ?? null,
      dataVencimento: d.dataVencimento ? String(d.dataVencimento).slice(0, 10) : null,
    })),
  );
  const docRef = useRef<HTMLInputElement>(null);
  const docIdx = useRef<number | null>(null);

  const [colaboradores, setColaboradores] = useState<Opt[]>([]);
  const [equipes, setEquipes] = useState<Opt[]>([]);
  const [manutencoes, setManutencoes] = useState<any[]>(initialData?.manutencoes ?? []);

  useEffect(() => {
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setColaboradores(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/equipes").then((r) => r.json()).then((d) => setEquipes(Array.isArray(d) ? d.map((e: any) => ({ id: e.id, nome: e.nome })) : [])).catch(() => {});
  }, []);

  function addDoc() { setDocumentos((p) => [...p, { tipo: "CRLV", nome: "", arquivoUrl: null, dataVencimento: null }]); }
  function updDoc(i: number, k: keyof DocItem, v: string | null) { setDocumentos((p) => p.map((d, idx) => (idx === i ? { ...d, [k]: v } : d))); }
  function removeDoc(i: number) { setDocumentos((p) => p.filter((_, idx) => idx !== i)); }
  function escolherArquivo(i: number) { docIdx.current = i; docRef.current?.click(); }
  function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; const i = docIdx.current;
    if (docRef.current) docRef.current.value = "";
    if (!file || i == null) return;
    if (file.size > 3 * 1024 * 1024) { setErro("Arquivo muito grande. Máximo 3 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => updDoc(i, "arquivoUrl", typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function salvar() {
    setErro("");
    if (!form.placa.trim()) { setErro("Placa é obrigatória."); setAba("identificacao"); return; }
    if (!form.modelo.trim()) { setErro("Modelo é obrigatório."); setAba("identificacao"); return; }
    if (documentos.some((d) => !d.nome.trim())) { setErro("Preencha o nome de todos os documentos."); setAba("documentos"); return; }
    setSalvando(true);
    try {
      const url = isEditing ? `/api/veiculos/${veiculoId}` : "/api/veiculos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, fotos, documentos,
          quilometragemAtual: form.quilometragemAtual || null,
          proximaRevisaoKm: form.proximaRevisaoKm || null,
          proximaRevisaoData: form.proximaRevisaoData || null,
          seguroVencimento: form.seguroVencimento || null,
        }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar veículo."); return; }
      router.push("/veiculos");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  const ABAS: { id: Aba; label: string; icone: any; badge?: number; soEdicao?: boolean }[] = [
    { id: "identificacao", label: "Identificação", icone: Truck },
    { id: "responsavel", label: "Responsável", icone: UserCog },
    { id: "documentos", label: "Documentos", icone: FileText, badge: documentos.length },
    { id: "manutencoes", label: "Manutenções", icone: Wrench, badge: manutencoes.length, soEdicao: true },
    { id: "checklists", label: "Checklists", icone: ClipboardCheck, badge: initialData?.checklists?.length, soEdicao: true },
  ];

  return (
    <div className="space-y-5">
      {erro && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
        </div>
      )}
      <input ref={docRef} type="file" onChange={handleDocFile} className="hidden" />

      <div className="bg-white rounded-2xl shadow-card border border-surface-border overflow-hidden">
        <nav className="flex gap-1.5 overflow-x-auto px-4 pt-4 pb-4 border-b border-surface-border">
          {ABAS.map((t) => {
            const ativa = aba === t.id;
            const desativada = t.soEdicao && !isEditing;
            return (
              <button key={t.id} type="button" disabled={desativada} onClick={() => setAba(t.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap transition-all",
                  ativa ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface-alt",
                  desativada && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-ink-muted",
                )}>
                <t.icone className="w-4 h-4" />
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", ativa ? "bg-white/25 text-white" : "bg-surface-alt text-ink-muted")}>{t.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-5 sm:p-6 lg:p-8 space-y-8">
          {/* ABA 1 — Identificação */}
          <div className={cn("space-y-8", aba !== "identificacao" && "hidden")}>
            <FormSection title="Fotos">
              <GaleriaImagens fotos={fotos} onChange={setFotos} />
            </FormSection>
            <FormSection title="Dados do veículo">
              <FormGrid cols={3}>
                <FormField label="Placa" required>
                  <Input value={form.placa} onChange={(e) => upd("placa", formatarPlaca(e.target.value))} placeholder="AAA-0000 ou AAA0A00" />
                </FormField>
                <FormField label="Tipo">
                  <Select value={form.tipo} onChange={(e) => upd("tipo", e.target.value)}>
                    {TIPOS_VEICULO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </Select>
                </FormField>
                <FormField label="Status">
                  <Select value={form.status} onChange={(e) => upd("status", e.target.value)}>
                    {STATUS_VEICULO.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </Select>
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Marca"><Input value={form.marca} onChange={(e) => upd("marca", e.target.value)} placeholder="Ex: Fiat" /></FormField>
                <FormField label="Modelo" required><Input value={form.modelo} onChange={(e) => upd("modelo", e.target.value)} placeholder="Ex: Fiorino" /></FormField>
                <FormField label="Ano"><Input value={form.ano} onChange={(e) => upd("ano", e.target.value)} placeholder="2022" /></FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Cor"><Input value={form.cor} onChange={(e) => upd("cor", e.target.value)} /></FormField>
                <FormField label="Chassi"><Input value={form.chassi} onChange={(e) => upd("chassi", e.target.value)} /></FormField>
                <FormField label="RENAVAM"><Input value={form.renavam} onChange={(e) => upd("renavam", e.target.value)} /></FormField>
              </FormGrid>
              <FormField label="Observações"><Textarea value={form.observacoes} onChange={(e) => upd("observacoes", e.target.value)} rows={2} /></FormField>
            </FormSection>
          </div>

          {/* ABA 2 — Responsável */}
          <div className={cn("space-y-8", aba !== "responsavel" && "hidden")}>
            <FormSection title="Responsável e equipe">
              <FormGrid>
                <FormField label="Colaborador / motorista responsável">
                  <Select value={form.responsavelId} onChange={(e) => upd("responsavelId", e.target.value)}>
                    <option value="">Selecione…</option>
                    {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </Select>
                </FormField>
                <FormField label="Equipe vinculada">
                  <Select value={form.equipeId} onChange={(e) => upd("equipeId", e.target.value)}>
                    <option value="">Selecione…</option>
                    {equipes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </Select>
                </FormField>
              </FormGrid>
              <FormField label="Quilometragem atual">
                <Input type="number" value={form.quilometragemAtual} onChange={(e) => upd("quilometragemAtual", e.target.value)} placeholder="0" />
              </FormField>
            </FormSection>
          </div>

          {/* ABA 3 — Documentos */}
          <div className={cn("space-y-6", aba !== "documentos" && "hidden")}>
            <FormSection title="Vencimento do seguro">
              <FormField label="Data de vencimento do seguro" hint="Gera alerta no dashboard 30 dias antes de vencer">
                <Input type="date" value={form.seguroVencimento} onChange={(e) => upd("seguroVencimento", e.target.value)} className="sm:max-w-xs" />
              </FormField>
            </FormSection>
            <FormSection title="Documentos do veículo">
              <p className="text-sm text-ink-muted -mt-1">CRLV, seguro, IPVA e demais documentos. Vencidos ou vencendo em 30 dias são destacados.</p>
              {documentos.length === 0 ? (
                <p className="text-sm text-ink-subtle py-4 text-center border border-dashed border-surface-border rounded-lg">Nenhum documento adicionado.</p>
              ) : (
                <div className="space-y-3">
                  {documentos.map((doc, i) => {
                    const venc = doc.dataVencimento;
                    const vencido = venc && new Date(venc).getTime() < Date.now();
                    const alerta = !vencido && venc && new Date(venc).getTime() <= Date.now() + 30 * 864e5;
                    return (
                      <div key={i} className="border border-surface-border rounded-lg p-3 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <FormField label="Tipo">
                            <Select value={doc.tipo} onChange={(e) => updDoc(i, "tipo", e.target.value)}>
                              {TIPOS_DOC_VEICULO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                            </Select>
                          </FormField>
                          <FormField label="Nome / descrição"><Input value={doc.nome} onChange={(e) => updDoc(i, "nome", e.target.value)} placeholder="Ex: CRLV 2026" /></FormField>
                          <FormField label="Vencimento"><Input type="date" value={doc.dataVencimento ?? ""} onChange={(e) => updDoc(i, "dataVencimento", e.target.value || null)} /></FormField>
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="secondary" onClick={() => escolherArquivo(i)} className="text-xs py-1 px-2.5 h-auto">
                              <Upload className="w-3.5 h-3.5" /> {doc.arquivoUrl ? "Trocar arquivo" : "Anexar arquivo"}
                            </Button>
                            {doc.arquivoUrl && <span className="text-xs text-success-600">Arquivo anexado</span>}
                            {vencido && <span className="text-xs font-semibold bg-red-50 text-red-700 px-2 py-0.5 rounded-full">Vencido</span>}
                            {alerta && <span className="text-xs font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">Vence em 30 dias</span>}
                          </div>
                          <button type="button" onClick={() => removeDoc(i)} className="text-red-500 hover:text-red-700 p-1.5"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button type="button" variant="secondary" onClick={addDoc} className="w-full justify-center border-dashed">
                <Plus className="w-4 h-4" /> Adicionar documento
              </Button>
            </FormSection>
          </div>

          {/* ABA 4 — Manutenções */}
          <div className={cn("space-y-8", aba !== "manutencoes" && "hidden")}>
            <FormSection title="Próxima revisão">
              <FormGrid>
                <FormField label="Próxima revisão — Quilometragem"><Input type="number" value={form.proximaRevisaoKm} onChange={(e) => upd("proximaRevisaoKm", e.target.value)} placeholder="Ex: 60000" /></FormField>
                <FormField label="Próxima revisão — Data"><Input type="date" value={form.proximaRevisaoData} onChange={(e) => upd("proximaRevisaoData", e.target.value)} /></FormField>
              </FormGrid>
            </FormSection>
            {isEditing && <ManutencoesPanel veiculoId={veiculoId!} manutencoes={manutencoes} setManutencoes={setManutencoes} />}
          </div>

          {/* ABA 5 — Checklists */}
          <div className={cn("space-y-6", aba !== "checklists" && "hidden")}>
            <FormSection title="Histórico de checklists">
              <Link href={`/veiculos/checklist?veiculoId=${veiculoId ?? ""}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700">
                <ClipboardCheck className="w-4 h-4" /> Preencher novo checklist
              </Link>
              {(initialData?.checklists ?? []).length === 0 ? (
                <p className="text-sm text-ink-subtle py-4 text-center border border-dashed border-surface-border rounded-lg">Nenhum checklist preenchido ainda.</p>
              ) : (
                <div className="border border-surface-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-alt border-b border-surface-border">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold text-ink-muted text-xs uppercase tracking-wider">Data</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-ink-muted text-xs uppercase tracking-wider">Colaborador</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(initialData?.checklists ?? []).map((c: any) => (
                        <tr key={c.id} className="border-b border-surface-border">
                          <td className="px-4 py-2.5">{formatarData(c.criadoEm)}</td>
                          <td className="px-4 py-2.5 text-ink-muted">{c.colaborador?.nome ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full",
                              c.status === "COM_ALERTAS" ? "bg-amber-50 text-amber-700" : c.status === "CONCLUIDO" ? "bg-success-50 text-success-700" : "bg-surface-alt text-ink-muted")}>
                              {c.status === "COM_ALERTAS" ? "Com alertas" : c.status === "CONCLUIDO" ? "Concluído" : "Pendente"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </FormSection>
            {ocorrencias && ocorrencias.length > 0 && (
              <FormSection title="Ocorrências por item (alertas recorrentes)">
                <div className="space-y-2">
                  {ocorrencias.map((o) => {
                    const max = Math.max(...ocorrencias.map((x) => x.count));
                    return (
                      <div key={o.descricao} className="flex items-center gap-3">
                        <span className="text-sm text-ink w-48 shrink-0 truncate" title={o.descricao}>{o.descricao}</span>
                        <div className="flex-1 bg-surface-alt rounded-full h-4 overflow-hidden">
                          <div className="bg-amber-400 h-full rounded-full" style={{ width: `${(o.count / max) * 100}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-ink-muted w-8 text-right">{o.count}</span>
                      </div>
                    );
                  })}
                </div>
              </FormSection>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar}>{isEditing ? "Salvar alterações" : "Cadastrar veículo"}</Button>
      </div>
    </div>
  );
}

function ManutencoesPanel({ veiculoId, manutencoes, setManutencoes }: { veiculoId: string; manutencoes: any[]; setManutencoes: (m: any[]) => void }) {
  const [mostra, setMostra] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [m, setM] = useState({ tipo: "PREVENTIVA", descricao: "", quilometragem: "", custo: "", dataRealizacao: "", proximaData: "", proximaKm: "" });

  async function registrar() {
    if (!m.descricao.trim() || !m.dataRealizacao) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/veiculos/${veiculoId}/manutencoes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...m,
          quilometragem: m.quilometragem || null, custo: m.custo || null,
          proximaData: m.proximaData || null, proximaKm: m.proximaKm || null,
        }),
      });
      if (res.ok) {
        const nova = await res.json();
        setManutencoes([nova, ...manutencoes]);
        setM({ tipo: "PREVENTIVA", descricao: "", quilometragem: "", custo: "", dataRealizacao: "", proximaData: "", proximaKm: "" });
        setMostra(false);
      }
    } catch {} finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!confirm("Remover esta manutenção?")) return;
    await fetch(`/api/veiculos/${veiculoId}/manutencoes?manutencaoId=${id}`, { method: "DELETE" });
    setManutencoes(manutencoes.filter((x) => x.id !== id));
  }

  return (
    <FormSection title="Histórico de manutenções">
      {manutencoes.length === 0 ? (
        <p className="text-sm text-ink-subtle py-4 text-center border border-dashed border-surface-border rounded-lg">Nenhuma manutenção registrada.</p>
      ) : (
        <div className="space-y-2">
          {manutencoes.map((mn) => (
            <div key={mn.id} className="flex items-start justify-between gap-3 border border-surface-border rounded-lg p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">{TIPOS_MANUT.find((t) => t.v === mn.tipo)?.l ?? mn.tipo}</span>
                  <span className="text-sm font-medium text-ink">{mn.descricao}</span>
                </div>
                <p className="text-xs text-ink-muted mt-1">
                  {formatarData(mn.dataRealizacao)}
                  {mn.quilometragem != null && ` · ${mn.quilometragem} km`}
                  {mn.custo != null && ` · ${formatarMoeda(Number(mn.custo))}`}
                </p>
              </div>
              <button type="button" onClick={() => remover(mn.id)} className="text-red-500 hover:text-red-700 p-1.5 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}

      {mostra ? (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-700">Registrar manutenção</h4>
            <button type="button" onClick={() => setMostra(false)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
          </div>
          <FormGrid cols={3}>
            <FormField label="Tipo"><Select value={m.tipo} onChange={(e) => setM((s) => ({ ...s, tipo: e.target.value }))}>{TIPOS_MANUT.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</Select></FormField>
            <FormField label="Data" required><Input type="date" value={m.dataRealizacao} onChange={(e) => setM((s) => ({ ...s, dataRealizacao: e.target.value }))} /></FormField>
            <FormField label="Quilometragem"><Input type="number" value={m.quilometragem} onChange={(e) => setM((s) => ({ ...s, quilometragem: e.target.value }))} /></FormField>
          </FormGrid>
          <FormField label="Descrição" required><Input value={m.descricao} onChange={(e) => setM((s) => ({ ...s, descricao: e.target.value }))} placeholder="Ex: Troca de óleo e filtros" /></FormField>
          <FormGrid cols={3}>
            <FormField label="Custo"><Input type="number" step="0.01" value={m.custo} onChange={(e) => setM((s) => ({ ...s, custo: e.target.value }))} placeholder="0,00" /></FormField>
            <FormField label="Próxima — Data"><Input type="date" value={m.proximaData} onChange={(e) => setM((s) => ({ ...s, proximaData: e.target.value }))} /></FormField>
            <FormField label="Próxima — Km"><Input type="number" value={m.proximaKm} onChange={(e) => setM((s) => ({ ...s, proximaKm: e.target.value }))} /></FormField>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMostra(false)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={registrar}>Registrar</Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setMostra(true)} className="w-full justify-center border-dashed">
          <Plus className="w-4 h-4" /> Registrar manutenção
        </Button>
      )}
    </FormSection>
  );
}
