"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gift, ImagePlus, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { reduzirImagem } from "@/lib/imagem-cliente";
import { IMAGEM_MAX, MSG_IMAGEM, MSG_IMAGEM_GRANDE, rotuloCompetencia, somarMeses } from "@/lib/desempenho/regras";
import type { PremiacaoNaLista } from "@/lib/desempenho/premiacoes-server";
import { CabecalhoDesempenho, Erro, JSON_HEADERS, SeletorDeMes, type PodeDesempenho } from "./comum";

interface PerfilOpcao { id: string; nome: string }

/**
 * Premiação do mês: o brinde em disputa (texto + imagem). Todos que veem o Desempenho veem a
 * premiação; cadastrar, editar e excluir é de quem tem "Desempenho › Gerenciar".
 */
export function PremiacoesDesempenho({ mesAtual, pode, perfis }: { mesAtual: string; pode: PodeDesempenho; perfis: PerfilOpcao[] }) {
  const [mes, setMes] = useState(mesAtual);
  const [lista, setLista] = useState<PremiacaoNaLista[] | null>(null);
  const [erro, setErro] = useState("");
  const [formulario, setFormulario] = useState<PremiacaoNaLista | "nova" | null>(null);
  const [excluindo, setExcluindo] = useState<PremiacaoNaLista | null>(null);
  // A imagem trocada precisa ser pedida de novo ao servidor
  const [versao, setVersao] = useState(0);

  const carregar = useCallback(async (competencia: string) => {
    setErro("");
    try {
      const r = await fetch(`/api/desempenho/premiacoes?mes=${competencia}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível carregar as premiações."); return; }
      setLista(Array.isArray(d) ? d : []);
    } catch { setErro("Erro de conexão."); }
  }, []);
  useEffect(() => { setLista(null); void carregar(mes); }, [carregar, mes]);
  const aposMudar = () => { setFormulario(null); setExcluindo(null); setVersao((v) => v + 1); void carregar(mes); };

  return (
    <div className="space-y-4" data-premiacoes-desempenho data-mes={mes}>
      <CabecalhoDesempenho ativa="premiacoes" pode={pode} acoes={(
        <>
          {/* A premiação do mês seguinte pode ser cadastrada antes de ele começar */}
          <SeletorDeMes mes={mes} aoMudar={setMes} max={somarMeses(mesAtual, 12)} />
          {pode.gerenciar && <Button type="button" size="sm" onClick={() => setFormulario("nova")} data-nova-premiacao><Plus className="w-4 h-4" /> Nova premiação</Button>}
        </>
      )} />
      <Erro texto={erro} data-erro-premiacoes="" />
      {!lista ? (!erro && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>)
        : lista.length === 0 ? (
          <div className="bg-white border border-surface-border rounded-xl text-center px-4 py-12 space-y-2" data-sem-premiacao>
            <Gift className="w-7 h-7 text-ink-subtle mx-auto" aria-hidden />
            <p className="text-sm text-ink-muted">Nenhuma premiação cadastrada para {rotuloCompetencia(mes)}.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-lista-premiacoes>
            {lista.map((p) => (
              <li key={p.id} className="bg-white border border-surface-border rounded-xl overflow-hidden flex flex-col" data-premiacao={p.titulo}>
                {p.temImagem
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/desempenho/premiacoes/${p.id}/imagem?v=${versao}`} alt={`Imagem do prêmio: ${p.titulo}`} className="w-full h-44 object-cover bg-surface-alt" data-premiacao-imagem />
                  : <div className="w-full h-44 bg-surface-alt grid place-items-center" data-premiacao-sem-imagem><Gift className="w-9 h-9 text-ink-subtle" aria-hidden /></div>}
                <div className="p-4 flex-1 flex flex-col gap-1">
                  <p className="font-semibold text-ink break-words" data-premiacao-titulo>{p.titulo}</p>
                  {p.descricao && <p className="text-sm text-ink-muted whitespace-pre-line break-words">{p.descricao}</p>}
                  <p className="text-xs text-ink-muted mt-auto pt-2" data-premiacao-disputa>{p.perfil ? `Disputa do perfil ${p.perfil}` : "Disputa de todos os perfis"}</p>
                </div>
                {pode.gerenciar && (
                  <div className="px-3 py-2 border-t border-surface-border flex justify-end gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setFormulario(p)} data-editar><Pencil className="w-3.5 h-3.5" /> Editar</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setExcluindo(p)} data-excluir className="hover:text-atrasado"><Trash2 className="w-3.5 h-3.5" /> Excluir</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {formulario && (
        <Formulario key={formulario === "nova" ? "nova" : formulario.id} premiacao={formulario === "nova" ? null : formulario} mes={mes} perfis={perfis} versao={versao}
          aoFechar={() => setFormulario(null)} aoSalvar={aposMudar} />
      )}
      {excluindo && <Excluir key={excluindo.id} premiacao={excluindo} aoFechar={() => setExcluindo(null)} aoSalvar={aposMudar} />}
    </div>
  );
}

interface PropsDialogo { aoFechar: () => void; aoSalvar: () => void }

function Formulario({ premiacao, mes, perfis, versao, aoFechar, aoSalvar }: PropsDialogo & { premiacao: PremiacaoNaLista | null; mes: string; perfis: PerfilOpcao[]; versao: number }) {
  const [form, setForm] = useState({ titulo: premiacao?.titulo ?? "", descricao: premiacao?.descricao ?? "", perfilId: premiacao?.perfilId ?? "" });
  const set = (campo: keyof typeof form, valor: string) => { setForm((f) => ({ ...f, [campo]: valor })); setErro(""); };
  // undefined = a imagem fica como está; null = tirar; texto = a nova
  const [imagem, setImagem] = useState<string | null | undefined>(undefined);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const competencia = premiacao?.competencia ?? mes;
  const previa = imagem ?? (imagem === undefined && premiacao?.temImagem ? `/api/desempenho/premiacoes/${premiacao.id}/imagem?v=${versao}` : null);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErro("");
    if (!f.type.startsWith("image/")) { setErro(MSG_IMAGEM); return; }
    try {
      // Foto de celular é reduzida no navegador antes de subir
      const { imagem: reduzida } = await reduzirImagem(f, 1000, 0.8);
      if (reduzida.dataUrl.length > IMAGEM_MAX) { setErro(MSG_IMAGEM_GRANDE); return; }
      setImagem(reduzida.dataUrl);
    } catch { setErro(MSG_IMAGEM); }
  }

  async function salvar() {
    if (form.titulo.trim().length < 2) { setErro("Dê um título à premiação."); return; }
    setErro(""); setSalvando(true);
    try {
      const corpo = { competencia, titulo: form.titulo, descricao: form.descricao || null, perfilId: form.perfilId || null, ...(imagem !== undefined && { imagem }) };
      const r = await fetch(premiacao ? `/api/desempenho/premiacoes/${premiacao.id}` : "/api/desempenho/premiacoes", {
        method: premiacao ? "PUT" : "POST", headers: JSON_HEADERS, body: JSON.stringify(corpo),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível salvar a premiação."); return; }
      aoSalvar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo={premiacao ? "Editar premiação" : "Nova premiação"} tamanho="lg">
      <div className="space-y-4" data-modal-premiacao>
        <p className="text-sm text-ink-muted" data-premiacao-mes>Premiação de <span className="font-medium text-ink">{rotuloCompetencia(competencia)}</span>.</p>
        <FormField label="Título" required>
          <Input aria-label="Título da premiação" value={form.titulo} maxLength={80} onChange={(e) => set("titulo", e.target.value)} placeholder="Ex: Kit de ferramentas" data-campo-titulo />
        </FormField>
        <FormField label="Descrição" hint="Opcional. O que é o brinde e como se ganha.">
          <Textarea aria-label="Descrição da premiação" rows={3} maxLength={600} value={form.descricao} onChange={(e) => set("descricao", e.target.value)} data-campo-descricao />
        </FormField>
        <FormField label="Quem disputa">
          <Select aria-label="Quem disputa" value={form.perfilId} onChange={(e) => set("perfilId", e.target.value)} data-campo-perfil>
            <option value="">Todos os perfis</option>
            {perfis.map((p) => <option key={p.id} value={p.id}>Só o perfil {p.nome}</option>)}
          </Select>
        </FormField>
        <FormField label="Imagem do brinde" hint="Opcional. JPG, PNG ou WebP; é reduzida ao enviar.">
          <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={escolher} aria-label="Imagem do brinde" data-arquivo-imagem />
          {previa ? (
            <div className="flex items-center gap-3" data-previa-imagem>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previa} alt="Imagem escolhida para o brinde" className="w-28 h-28 rounded-lg object-cover bg-surface-alt" />
              <div className="flex flex-col gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => entrada.current?.click()} data-trocar-imagem><ImagePlus className="w-3.5 h-3.5" /> Trocar imagem</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setImagem(null)} data-tirar-imagem><Trash2 className="w-3.5 h-3.5" /> Excluir imagem</Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => entrada.current?.click()} data-enviar-imagem
              className="w-full inline-flex items-center justify-center gap-2 border border-dashed border-surface-border rounded-lg px-3 py-6 text-sm text-ink-muted hover:bg-surface-alt">
              <ImagePlus className="w-4 h-4" /> Enviar imagem
            </button>
          )}
        </FormField>
        <Erro texto={erro} data-erro-premiacao="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-premiacao>{premiacao ? "Salvar" : "Cadastrar premiação"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Excluir({ premiacao, aoFechar, aoSalvar }: PropsDialogo & { premiacao: PremiacaoNaLista }) {
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function excluir() {
    setErro(""); setSalvando(true);
    try {
      const r = await fetch(`/api/desempenho/premiacoes/${premiacao.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível excluir a premiação."); return; }
      aoSalvar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }
  return (
    <Modal aberto onFechar={aoFechar} titulo="Excluir premiação" tamanho="sm">
      <div className="space-y-4" data-modal-excluir-premiacao>
        <p className="text-sm text-ink">A premiação <span className="font-medium">{premiacao.titulo}</span> de {rotuloCompetencia(premiacao.competencia)} deixa de aparecer no painel e na TV.</p>
        <Erro texto={erro} />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant="danger" loading={salvando} onClick={excluir} data-confirmar-exclusao>Excluir</Button>
        </div>
      </div>
    </Modal>
  );
}
