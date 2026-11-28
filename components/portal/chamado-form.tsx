"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BuscaSelect } from "@/components/ui/busca-select";
import { reduzirImagem, FOTO_GALERIA } from "@/lib/imagem-cliente";
import { Siren, Upload, X, Send } from "lucide-react";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";

interface Unidade { id: string; nome: string }
interface Equip { id: string; nome: string; unidadeId: string }
interface Foto { nome: string; tipo: string; tamanho: number; conteudo: string }

export function ChamadoForm({ unidades, equipamentos, tiposProblema, confirmacoesPendentes = 0 }: {
  unidades: Unidade[]; equipamentos: Equip[]; tiposProblema: string[];
  /** A empresa pede a confirmação dos serviços antes de um novo chamado e há N pendentes (0 = livre) */
  confirmacoesPendentes?: number;
}) {
  const router = useRouter();
  // Saída de emergência: existe sempre — climatização parada não espera a confirmação de um serviço antigo
  const [emergencia, setEmergencia] = useState(false);
  const [unidadeId, setUnidadeId] = useState("");
  const [equipamentoId, setEquipamentoId] = useState("");
  const [tipoProblema, setTipoProblema] = useState("");
  const [descricao, setDescricao] = useState("");
  const [urgencia, setUrgencia] = useState("NORMAL");
  const [fotos, setFotos] = useState<Foto[]>([]);
  // ERRO NO CAMPO: descrição curta, foto ilegível, unidade/equipamento recusados pelo servidor: cada um no seu campo
  const erros = useErrosDoFormulario();
  const [enviando, setEnviando] = useState(false);

  const equipsDaUnidade = useMemo(
    () => (unidadeId ? equipamentos.filter((e) => e.unidadeId === unidadeId) : equipamentos),
    [unidadeId, equipamentos],
  );

  async function addFotos(files: FileList | null) {
    if (!files) return;
    erros.limpar("fotos");
    const novas: Foto[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      try {
        // Foto do celular sai com vários MB: reduz e recomprime antes de enviar (o servidor limita o tamanho)
        const { imagem } = await reduzirImagem(f, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade);
        novas.push({ nome: f.name, tipo: "image/jpeg", tamanho: imagem.bytes, conteudo: imagem.dataUrl });
      } catch {
        erros.definirCampo("fotos", `Não foi possível ler a imagem "${f.name}". Envie fotos JPG, PNG ou WEBP.`);
      }
    }
    setFotos((p) => [...p, ...novas].slice(0, 6));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!erros.validar(descricao.trim().length < 5 ? { descricao: "Descreva o problema com mais detalhes." } : {})) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/portal/chamados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unidadeId: unidadeId || null, equipamentoId: equipamentoId || null, tipoProblema: tipoProblema || null, descricao: descricao.trim(), urgencia, fotos, ...(emergencia ? { emergencia: true } : {}) }),
      });
      if (!res.ok) { erros.erroDaApi(await res.json().catch(() => ({})), "Erro ao abrir chamado."); return; }
      const data = await res.json();
      router.push(`/portal/chamados/${data.id}`);
      router.refresh();
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); } finally { setEnviando(false); }
  }


  if (confirmacoesPendentes > 0 && !emergencia) {
    return (
      <div className="bg-white rounded-card border border-surface-border p-5 space-y-3" data-chamado-bloqueado>
        <p className="text-sm text-ink">
          <span>Para abrir um novo chamado, confirme primeiro {confirmacoesPendentes === 1 ? "o serviço acima" : "os serviços acima"}. </span>
          <span>Depois de confirmar, é só voltar a esta página.</span>
        </p>
        <div className="border-t border-surface-border pt-3 space-y-2">
          <p className="text-sm text-ink-muted">Equipamento parado ou risco no local? O chamado de emergência abre agora, sem esperar a confirmação.</p>
          <button type="button" onClick={() => setEmergencia(true)} data-emergencia
            className="inline-flex items-center gap-2 border border-atrasado/30 bg-atrasado-claro text-atrasado-texto font-semibold px-4 py-2.5 rounded-lg hover:brightness-95">
            <Siren className="w-4 h-4" aria-hidden /> É uma emergência: abrir chamado agora
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={enviar} className="space-y-4 bg-white rounded-card border border-surface-border p-5" noValidate>
      {emergencia && (
        <p className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2" data-chamado-emergencia>
          <Siren className="w-4 h-4 shrink-0" aria-hidden /> Chamado de emergência. As confirmações continuam pendentes para depois.
        </p>
      )}
      <ResumoDeErros className="py-2 px-3" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Endereço / unidade" name="unidadeId" valor={unidadeId}>
          {/* Um cliente pode ter muitas unidades e muitos equipamentos: campo com busca */}
          <BuscaSelect
            rotulo="Endereço / unidade" atributos={{ "data-unidade": "" }} placeholder="Selecione"
            value={unidadeId} onChange={(v) => { setUnidadeId(v); setEquipamentoId(""); }}
            options={unidades.map((u) => ({ value: u.id, label: u.nome }))}
          />
        </FormField>
        <FormField label="Equipamento" name="equipamentoId" valor={equipamentoId}>
          <BuscaSelect
            rotulo="Equipamento" atributos={{ "data-equipamento": "" }} placeholder="Selecione (opcional)"
            value={equipamentoId} onChange={setEquipamentoId}
            options={equipsDaUnidade.map((e) => ({ value: e.id, label: e.nome }))}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Tipo do problema" name="tipoProblema">
          <Select value={tipoProblema} onChange={(e) => setTipoProblema(e.target.value)} className="min-h-[44px]">
            <option value="">Selecione</option>
            {tiposProblema.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
        <FormField label="Urgência" name="urgencia">
          <Select value={urgencia} onChange={(e) => setUrgencia(e.target.value)} className="min-h-[44px]">
            <option value="NORMAL">Normal</option>
            <option value="URGENTE">Urgente</option>
            <option value="CRITICO">Crítico</option>
          </Select>
        </FormField>
      </div>

      <FormField label="Descrição do problema" name="descricao" required>
        <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} placeholder="Descreva o que está acontecendo…" />
      </FormField>

      <FormField label="Fotos (opcional)" name="fotos">
        <div className="flex flex-wrap gap-2">
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
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFotos(e.target.files)} aria-label="Adicionar fotos" />
            </label>
          )}
        </div>
      </FormField>

      <div className="flex justify-end">
        <button type="submit" disabled={enviando} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold px-5 py-2.5 rounded-lg transition-all disabled:opacity-60">
          <Send className="w-4 h-4" /> {enviando ? "Enviando…" : "Enviar chamado"}
        </button>
      </div>
    </form>
    </ErrosDoFormulario>
  );
}
