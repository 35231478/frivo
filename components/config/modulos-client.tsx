"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, ShoppingCart, Truck, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmar, toast } from "@/components/ui/avisos";
import { cn, formatarData } from "@/lib/utils";

export interface ModuloLinha {
  id: string;
  nome: string;
  descricao: string;
  icone: string;
  dependeDe: string[];
  ativo: boolean;
  alteradoEm: string | Date | null;
  alteradoPor: string | null;
}

const ICONES: Record<string, typeof Truck> = { Truck, ShoppingCart, Package };

/**
 * Os módulos que a empresa liga e desliga. Esta é a versão MÍNIMA do piloto: mostra só os
 * módulos cujo gate já vale nas três camadas. A loja completa — com todos os módulos, categorias
 * e cartões — vem depois; aqui o que importa é a mecânica funcionando de ponta a ponta.
 *
 * Desligar NUNCA apaga: a tela diz isso em voz alta, porque é a primeira dúvida de quem clica.
 */
export function ModulosClient({ inicial, podeEditar }: { inicial: ModuloLinha[]; podeEditar: boolean }) {
  const router = useRouter();
  const [modulos, setModulos] = useState(inicial);
  const [salvando, setSalvando] = useState<string | null>(null);

  async function alternar(m: ModuloLinha) {
    const ligar = !m.ativo;
    if (!ligar) {
      // Antes de desligar, perguntar ao servidor o que mais cai junto (dependências)
      const previa = await fetch("/api/configuracoes/modulos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modulo: m.id, ativo: false }),
      }).then((r) => r.json()).catch(() => ({ aviso: "" }));

      const sim = await confirmar({
        titulo: `Desligar ${m.nome}?`,
        mensagem: [
          `${m.nome} some do menu e as telas dele param de abrir para todo mundo da empresa.`,
          previa?.aviso,
          "Nada é apagado: os dados ficam no lugar e voltam ao religar.",
        ].filter(Boolean).join(" "),
        confirmarTexto: "Desligar",
        perigo: true,
      });
      if (!sim) return;
    }

    setSalvando(m.id);
    try {
      const res = await fetch("/api/configuracoes/modulos", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modulo: m.id, ativo: ligar }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast(d?.erro || "Não foi possível mudar o módulo.", "erro"); return; }
      setModulos(d.modulos);
      toast(ligar ? `${m.nome} ligado.` : `${m.nome} desligado.${d.aviso ? " " + d.aviso : ""}`);
      router.refresh(); // o menu é montado no servidor: a mudança aparece na hora
    } catch {
      toast("Sem conexão. Tente de novo.", "erro");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="space-y-2" data-lista-modulos>
      {modulos.map((m) => {
        const Icone = ICONES[m.icone] ?? Package;
        return (
          <div key={m.id} className="card p-4 flex items-start gap-3" data-modulo={m.id} data-ativo={m.ativo ? "sim" : "nao"}>
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
              m.ativo ? "bg-acento-claro text-acento" : "bg-surface-alt text-ink-subtle")}>
              <Icone className="w-5 h-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-ink">{m.nome}</p>
                <span className={cn("text-[11px] px-2", m.ativo ? "pill-ok" : "pill-previsto")} data-estado-modulo>
                  {m.ativo ? "Ligado" : "Desligado"}
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-0.5">{m.descricao}</p>
              {m.alteradoEm && (
                <p className="text-[11px] text-ink-subtle mt-1" data-auditoria-modulo>
                  {m.ativo ? "Ligado" : "Desligado"} por {m.alteradoPor ?? "—"} em {formatarData(m.alteradoEm)}
                </p>
              )}
            </div>
            {podeEditar && (
              <Button
                variant={m.ativo ? "secondary" : "primary"}
                onClick={() => alternar(m)}
                loading={salvando === m.id}
                data-alternar-modulo={m.id}
              >
                {m.ativo ? <><PowerOff className="w-4 h-4" aria-hidden /> Desligar</> : <><Power className="w-4 h-4" aria-hidden /> Ligar</>}
              </Button>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink-muted pt-1" data-nota-modulos>
        O módulo desligado impede criar coisa nova nele — o que já existe continua guardado.
      </p>
    </div>
  );
}
