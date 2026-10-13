"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { LABELS_RESPONSAVEL_PRAZO, LABELS_CANAL_NOTIFICACAO } from "@/lib/utils";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";

type UnidadePrazo = "minutos" | "horas" | "dias";
interface Etapa { _id: string; nome: string; valor: number; unidade: UnidadePrazo; responsavel: string; canal: string; mensagem: string }

const VARIAVEIS = ["{{os_numero}}", "{{cliente_nome}}", "{{produto_nome}}", "{{prazo_etapa}}", "{{link}}"];

function uid() { return Math.random().toString(36).slice(2); }

function horasParaUnidade(h: number): { valor: number; unidade: UnidadePrazo } {
  if (h < 1) return { valor: Math.round(h * 60), unidade: "minutos" };
  if (h >= 24 && h % 24 === 0) return { valor: h / 24, unidade: "dias" };
  return { valor: h, unidade: "horas" };
}

function unidadeParaHoras(valor: number, unidade: UnidadePrazo): number {
  if (unidade === "minutos") return valor / 60;
  if (unidade === "dias") return valor * 24;
  return valor;
}

/** Editor de modelo de prazo (CadastroPadrao › modelos-prazo): nome, cor, descrição e as etapas (SLA). */
export function EditorModeloPrazo({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState("#0EA5E9");
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setNome(item?.nome ?? ""); setDescricao((item?.descricao as string | null) ?? ""); setCor(item?.cor ?? "#0EA5E9");
    setEtapas((Array.isArray(item?.etapas) ? item.etapas : []).map((e: any) => {
      const u = horasParaUnidade(Number(e.prazoHoras));
      return { _id: uid(), nome: e.nome, valor: u.valor, unidade: u.unidade, responsavel: e.responsavel, canal: e.canal, mensagem: e.mensagem ?? "" };
    }));
  }, [aberto, item]);

  function addEtapa() {
    setEtapas((p) => [...p, { _id: uid(), nome: "", valor: 24, unidade: "horas", responsavel: "COMPRADOR", canal: "WHATSAPP", mensagem: "" }]);
  }
  const patchEtapa = (id: string, patch: Partial<Etapa>) => setEtapas((p) => p.map((e) => (e._id === id ? { ...e, ...patch } : e)));
  const removerEtapa = (id: string) => setEtapas((p) => p.filter((e) => e._id !== id));
  function mover(id: string, dir: -1 | 1) {
    setEtapas((p) => {
      const idx = p.findIndex((e) => e._id === id);
      const novo = idx + dir;
      if (novo < 0 || novo >= p.length) return p;
      const arr = [...p];
      [arr[idx], arr[novo]] = [arr[novo], arr[idx]];
      return arr;
    });
  }

  async function salvar() {
    if (!nome.trim()) { setErro("Informe o nome do modelo."); return; }
    if (etapas.length === 0) { setErro("Adicione ao menos uma etapa."); return; }
    if (etapas.some((e) => !e.nome.trim())) { setErro("Toda etapa precisa de um nome."); return; }
    if (etapas.some((e) => !(e.valor > 0))) { setErro("O prazo de cada etapa precisa ser maior que zero."); return; }
    setSalvando(true); setErro("");
    const r = await salvarCadastro("modelos-prazo", item?.id ?? null, {
      nome: nome.trim(), descricao: descricao.trim() || null, cor,
      etapas: etapas.map((e) => ({
        nome: e.nome.trim(), prazoHoras: unidadeParaHoras(e.valor, e.unidade), responsavel: e.responsavel, canal: e.canal, mensagem: e.mensagem.trim() || null,
      })),
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : "Novo modelo de prazo"}
      largura="w-full sm:w-[60vw] sm:min-w-[520px] sm:max-w-[900px]"
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Criar"}</Button>
      </>}
    >
      <div className="space-y-4">
        {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}
        {item && item.ativo === false && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">Modelo inativo: não aparece em “Adicionar prazo” nas OS até ser reativado. Prazos já abertos continuam.</p>}

        <FormGrid cols={2}>
          <FormField label="Nome do prazo" required>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Compra de Material" />
          </FormField>
          <FormField label="Cor de identificação">
            <div className="flex items-center gap-2">
              <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="w-10 h-10 rounded border border-surface-border cursor-pointer" aria-label="Cor" />
              <Input value={cor} onChange={(e) => setCor(e.target.value)} className="flex-1 font-mono text-xs" />
            </div>
          </FormField>
        </FormGrid>
        <FormField label="Descrição">
          <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
        </FormField>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h5 className="text-xs font-bold text-ink-muted uppercase tracking-wider">Etapas do prazo</h5>
          </div>
          <div className="bg-white border border-surface-border rounded-lg p-2 mb-2 text-[11px] text-ink-muted">
            Variáveis disponíveis na mensagem:{" "}
            {VARIAVEIS.map((v) => <code key={v} className="bg-surface-alt rounded px-1 mx-0.5">{v}</code>)}
          </div>

          <div className="space-y-3">
            {etapas.map((e, idx) => (
              <div key={e._id} className="border border-surface-border rounded-lg p-3 bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                  <Input value={e.nome} onChange={(ev) => patchEtapa(e._id, { nome: ev.target.value })} placeholder="Nome da etapa" className="flex-1" />
                  <button type="button" onClick={() => mover(e._id, -1)} disabled={idx === 0} className="p-1.5 text-ink-muted hover:text-primary-600 disabled:opacity-30" aria-label="Subir etapa"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => mover(e._id, 1)} disabled={idx === etapas.length - 1} className="p-1.5 text-ink-muted hover:text-primary-600 disabled:opacity-30" aria-label="Descer etapa"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => removerEtapa(e._id)} className="p-1.5 text-ink-muted hover:text-red-600" aria-label="Remover etapa"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <FormGrid cols={3}>
                  <FormField label="Prazo">
                    <div className="flex gap-1">
                      <Input type="number" min="0" step="0.5" value={e.valor} onChange={(ev) => patchEtapa(e._id, { valor: Number(ev.target.value) || 0 })} className="flex-1" />
                      <Select value={e.unidade} onChange={(ev) => patchEtapa(e._id, { unidade: ev.target.value as UnidadePrazo })} className="w-28">
                        <option value="minutos">minutos</option>
                        <option value="horas">horas</option>
                        <option value="dias">dias</option>
                      </Select>
                    </div>
                  </FormField>
                  <FormField label="Responsável">
                    <Select value={e.responsavel} onChange={(ev) => patchEtapa(e._id, { responsavel: ev.target.value })}>
                      {Object.entries(LABELS_RESPONSAVEL_PRAZO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </FormField>
                  <FormField label="Canal">
                    <Select value={e.canal} onChange={(ev) => patchEtapa(e._id, { canal: ev.target.value })}>
                      {Object.entries(LABELS_CANAL_NOTIFICACAO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </FormField>
                </FormGrid>
                <FormField label="Mensagem de notificação">
                  <Textarea value={e.mensagem} onChange={(ev) => patchEtapa(e._id, { mensagem: ev.target.value })} rows={2} placeholder="Ex.: OS {{os_numero}} — etapa {{prazo_etapa}}. {{link}}" />
                </FormField>
              </div>
            ))}
          </div>

          <Button type="button" variant="secondary" onClick={addEtapa} className="w-full justify-center border-dashed mt-2">
            <Plus className="w-4 h-4" /> Adicionar etapa
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
