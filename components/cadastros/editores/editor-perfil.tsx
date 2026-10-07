"use client";

import { useEffect, useState } from "react";
import { Check, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";
import { SECOES, ACOES_LABEL, PRESETS, TIPOS_PERFIL_LABEL, permissoesVazias, type Permissoes, type Acao } from "@/lib/permissoes";

const TIPOS = ["ADMINISTRADOR", "SUPERVISOR", "FINANCEIRO", "TECNICO", "AUXILIAR", "PERSONALIZADO"];

function MiniToggle({ checked, onChange, rotulo }: { checked: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={rotulo} onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors", checked ? "bg-success-500" : "bg-surface-border")}
    >
      <span className={cn("inline-block h-[18px] w-[18px] rounded-full bg-white shadow transform transition-transform mt-[2px]", checked ? "translate-x-[20px]" : "translate-x-[2px]")} />
    </button>
  );
}

/**
 * Editor de perfil de acesso (CadastroPadrao › perfis-acesso): nome, tipo (carrega um modelo de
 * permissões), cor, descrição e a matriz de permissões. Grava pela rota genérica; as travas
 * contra autopromoção ficam no servidor (lib/cadastros/especificos.ts).
 */
export function EditorPerfil({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("PERSONALIZADO");
  const [cor, setCor] = useState("#8B5CF6");
  const [descricao, setDescricao] = useState("");
  const [permissoes, setPermissoes] = useState<Permissoes>(permissoesVazias());
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setNome(item?.nome ?? ""); setTipo(item?.tipo ?? "PERSONALIZADO"); setCor(item?.cor ?? "#8B5CF6"); setDescricao(item?.descricao ?? "");
    setPermissoes({ ...permissoesVazias(), ...(item?.permissoes ?? {}) });
  }, [aberto, item]);

  function aplicarPreset(novo: string) {
    setTipo(novo);
    if (PRESETS[novo]) setPermissoes(JSON.parse(JSON.stringify(PRESETS[novo])));
  }
  const setAcao = (modulo: string, acao: Acao, v: boolean) => setPermissoes((p) => ({ ...p, [modulo]: { ...p[modulo], [acao]: v } }));
  function marcarSecao(secaoId: string, v: boolean) {
    const secao = SECOES.find((s) => s.id === secaoId);
    if (!secao) return;
    setPermissoes((p) => {
      const n = { ...p };
      for (const m of secao.modulos) { n[m.id] = { ...n[m.id] }; for (const a of m.acoes) n[m.id][a] = v; }
      return n;
    });
  }

  async function salvar() {
    if (!nome.trim()) { setErro("Nome do perfil é obrigatório."); return; }
    setSalvando(true); setErro("");
    const r = await salvarCadastro("perfis-acesso", item?.id ?? null, { nome, tipo, cor, descricao, permissoes });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  const visiveis = SECOES.flatMap((s) => s.modulos).filter((m) => permissoes[m.id]?.visualizar);

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar} largura="w-full sm:max-w-3xl"
      titulo={item ? `Editar perfil ${item.nome}` : "Novo perfil de acesso"}
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Criar perfil"}</Button>
      </>}
    >
      <div className="space-y-5">
        {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}
        {item?.padraoSistema && <p className="text-xs text-ink-muted bg-surface-alt rounded-lg px-3 py-2">Perfil padrão do sistema: pode ser ajustado, mas não inativado.</p>}
        <FormGrid cols={3}>
          <FormField label="Nome do perfil" required className="sm:col-span-2"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Supervisor de Manutenção" /></FormField>
          <FormField label="Cor">
            <div className="flex items-center gap-2">
              <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="w-10 h-10 rounded border border-surface-border cursor-pointer" aria-label="Cor" />
              <Input value={cor} onChange={(e) => setCor(e.target.value)} className="flex-1 font-mono text-xs" />
            </div>
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Tipo" hint="Trocar o tipo carrega um modelo de permissões">
            <Select value={tipo} onChange={(e) => aplicarPreset(e.target.value)}>
              {TIPOS.map((t) => <option key={t} value={t}>{TIPOS_PERFIL_LABEL[t]}</option>)}
            </Select>
          </FormField>
          <FormField label="Descrição"><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Resumo do perfil" /></FormField>
        </FormGrid>

        <div className="space-y-4">
          {SECOES.map((secao) => (
            <div key={secao.id} className="border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-surface-alt border-b border-surface-border">
                <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">{secao.label}</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => marcarSecao(secao.id, true)} className="text-xs font-medium text-primary-600 hover:text-primary-700">Selecionar tudo</button>
                  <span className="text-ink-subtle">·</span>
                  <button type="button" onClick={() => marcarSecao(secao.id, false)} className="text-xs font-medium text-ink-muted hover:text-ink">Desmarcar</button>
                </div>
              </div>
              <div className="divide-y divide-surface-border">
                {secao.modulos.map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-4 px-4 py-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-[160px]">
                      <span className="text-lg leading-none">{m.icone}</span>
                      <span className="text-sm font-medium text-ink">{m.label}</span>
                    </div>
                    <div className="flex items-center gap-x-5 gap-y-2 flex-wrap justify-end">
                      {m.acoes.map((acao) => (
                        <label key={acao} className="flex items-center gap-1.5 cursor-pointer">
                          <MiniToggle checked={!!permissoes[m.id]?.[acao]} onChange={(v) => setAcao(m.id, acao, v)} rotulo={`${m.label}: ${ACOES_LABEL[acao]}`} />
                          <span className="text-xs text-ink-muted">{ACOES_LABEL[acao]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 bg-primary-50 border border-primary-100 rounded-lg px-4 py-3">
          <Eye className="w-4 h-4 text-primary-600 mt-0.5 shrink-0" />
          <p className="text-sm text-ink">
            <span className="font-semibold">Com estas permissões, quem tiver este perfil verá:</span>{" "}
            {visiveis.length > 0 ? visiveis.map((m) => m.label).join(", ") : "apenas o Dashboard"}.
          </p>
        </div>
      </div>
    </Drawer>
  );
}
