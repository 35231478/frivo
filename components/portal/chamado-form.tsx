"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Upload, X, Send } from "lucide-react";

interface Unidade { id: string; nome: string }
interface Equip { id: string; nome: string; unidadeId: string }
interface Foto { nome: string; tipo: string; tamanho: number; conteudo: string }

export function ChamadoForm({ unidades, equipamentos, tiposProblema }: { unidades: Unidade[]; equipamentos: Equip[]; tiposProblema: string[] }) {
  const router = useRouter();
  const [unidadeId, setUnidadeId] = useState("");
  const [equipamentoId, setEquipamentoId] = useState("");
  const [tipoProblema, setTipoProblema] = useState("");
  const [descricao, setDescricao] = useState("");
  const [urgencia, setUrgencia] = useState("NORMAL");
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const equipsDaUnidade = useMemo(
    () => (unidadeId ? equipamentos.filter((e) => e.unidadeId === unidadeId) : equipamentos),
    [unidadeId, equipamentos],
  );

  async function addFotos(files: FileList | null) {
    if (!files) return;
    const novas: Foto[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      const conteudo = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(f);
      });
      novas.push({ nome: f.name, tipo: f.type, tamanho: f.size, conteudo });
    }
    setFotos((p) => [...p, ...novas].slice(0, 6));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (descricao.trim().length < 5) return setErro("Descreva o problema com mais detalhes.");
    setEnviando(true);
    try {
      const res = await fetch("/api/portal/chamados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unidadeId: unidadeId || null, equipamentoId: equipamentoId || null, tipoProblema: tipoProblema || null, descricao: descricao.trim(), urgencia, fotos }),
      });
      if (!res.ok) { const er = await res.json().catch(() => ({})); setErro(er.erro ?? "Erro ao abrir chamado."); return; }
      const data = await res.json();
      router.push(`/portal/chamados/${data.id}`);
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setEnviando(false); }
  }

  const inputCls = "mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  return (
    <form onSubmit={enviar} className="space-y-4 bg-white rounded-xl border border-surface-border p-5">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{erro}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold text-ink">Endereço / unidade</label>
          <select value={unidadeId} onChange={(e) => { setUnidadeId(e.target.value); setEquipamentoId(""); }} className={inputCls}>
            <option value="">Selecione</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold text-ink">Equipamento</label>
          <select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)} className={inputCls}>
            <option value="">Selecione (opcional)</option>
            {equipsDaUnidade.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold text-ink">Tipo do problema</label>
          <select value={tipoProblema} onChange={(e) => setTipoProblema(e.target.value)} className={inputCls}>
            <option value="">Selecione</option>
            {tiposProblema.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold text-ink">Urgência</label>
          <select value={urgencia} onChange={(e) => setUrgencia(e.target.value)} className={inputCls}>
            <option value="NORMAL">Normal</option>
            <option value="URGENTE">Urgente</option>
            <option value="CRITICO">Crítico</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold text-ink">Descrição do problema</label>
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} placeholder="Descreva o que está acontecendo…" className={inputCls} />
      </div>

      <div>
        <label className="text-sm font-semibold text-ink">Fotos (opcional)</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {fotos.map((f, i) => (
            <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-surface-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.conteudo} alt={f.nome} className="w-full h-full object-cover" />
              <button type="button" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5"><X className="w-3 h-3" /></button>
            </div>
          ))}
          {fotos.length < 6 && (
            <label className="w-20 h-20 rounded-lg border-2 border-dashed border-surface-border flex flex-col items-center justify-center text-ink-subtle cursor-pointer hover:border-primary-300">
              <Upload className="w-5 h-5" />
              <span className="text-[10px]">Adicionar</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFotos(e.target.files)} />
            </label>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={enviando} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold px-5 py-2.5 rounded-lg transition-all disabled:opacity-60">
          <Send className="w-4 h-4" /> {enviando ? "Enviando…" : "Enviar chamado"}
        </button>
      </div>
    </form>
  );
}
