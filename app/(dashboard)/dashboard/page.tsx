import type { Metadata } from "next";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { pode, type Permissoes } from "@/lib/permissoes";
import { aplicarPreferencia, blocosPermitidos, COOKIE_DASHBOARD, lerPreferencia, type BlocoId } from "@/lib/dashboard/blocos";
import { carregarBlocos, type DadosBloco } from "@/lib/dashboard/dados";
import { partesBR } from "@/lib/fuso";
import { cn } from "@/lib/utils";
import { PersonalizarDashboard } from "@/components/dashboard/personalizar-dashboard";
import { BlocoComErro } from "@/components/dashboard/ui";
import { FrivoIA } from "@/components/ia/frivo-ia";
import {
  BlocoAgenda, BlocoComercial, BlocoEquipamentos, BlocoFinanceiro, BlocoFrota, BlocoOperacional, BlocoOsDoDia,
  BlocoPrazos, BlocoSolicitacoes,
} from "@/components/dashboard/blocos";
import {
  CalendarDays, ClipboardList, FileSignature, HardHat, Headset, LayoutDashboard, Thermometer, Timer, Truck, Wallet,
  type LucideIcon,
} from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };

const ICONES: Record<BlocoId, LucideIcon> = {
  operacional: ClipboardList, "os-do-dia": HardHat, solicitacoes: Headset, agenda: CalendarDays,
  comercial: FileSignature, financeiro: Wallet, equipamentos: Thermometer, frota: Truck, prazos: Timer,
};

function renderizar<K extends BlocoId>(id: K, d: DadosBloco[K]) {
  switch (id) {
    case "operacional": return <BlocoOperacional d={d as DadosBloco["operacional"]} />;
    case "os-do-dia": return <BlocoOsDoDia d={d as DadosBloco["os-do-dia"]} />;
    case "solicitacoes": return <BlocoSolicitacoes d={d as DadosBloco["solicitacoes"]} />;
    case "agenda": return <BlocoAgenda d={d as DadosBloco["agenda"]} />;
    case "comercial": return <BlocoComercial d={d as DadosBloco["comercial"]} />;
    case "financeiro": return <BlocoFinanceiro d={d as DadosBloco["financeiro"]} />;
    case "equipamentos": return <BlocoEquipamentos d={d as DadosBloco["equipamentos"]} />;
    case "frota": return <BlocoFrota d={d as DadosBloco["frota"]} />;
    case "prazos": return <BlocoPrazos d={d as DadosBloco["prazos"]} />;
  }
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user!;
  const permissoes = user.permissoes as Permissoes;
  const podeVer = (modulo: string, acao: string = "visualizar") => pode(permissoes, modulo, acao as any, user.role);

  // Blocos que o perfil pode ver, na ordem/visibilidade escolhidas pelo usuário (cookie deste navegador)
  const pref = lerPreferencia((await cookies()).get(COOKIE_DASHBOARD)?.value);
  const { todos, visiveis } = aplicarPreferencia(blocosPermitidos(permissoes, user.role), pref);

  // Só consulta o que vai aparecer; um bloco com erro não derruba a página
  const dados = await carregarBlocos(visiveis.map((b) => b.id), { empresaId: user.empresaId, podeVer });

  const { ano, mes, dia } = partesBR();
  const semana = new Date(Date.UTC(ano, mes, dia)).getUTCDay();
  const primeiroNome = (user.name ?? "").split(" ")[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{primeiroNome ? `Olá, ${primeiroNome}` : "Dashboard"}</h1>
          <p className="page-subtitle first-letter:uppercase">
            {DIAS[semana]}, {dia} de {MESES[mes]} · {user.empresaNome}
          </p>
        </div>
        {todos.length > 0 && (
          <PersonalizarDashboard
            blocos={todos.map((b) => ({ id: b.id, titulo: b.titulo, descricao: b.descricao }))}
            ocultosIniciais={pref.ocultos.filter((id) => todos.some((b) => b.id === id))}
          />
        )}
      </div>

      {visiveis.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-surface-border p-10 text-center">
          <LayoutDashboard className="w-8 h-8 text-ink-subtle mx-auto mb-2" />
          <p className="text-sm text-ink-muted">
            {todos.length === 0
              ? "Seu perfil de acesso ainda não libera nenhum módulo. Fale com o administrador."
              : "Todos os blocos estão ocultos. Use “Personalizar” para escolher o que ver."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5" data-dashboard-blocos>
          {visiveis.map((b) => {
            const d = dados[b.id];
            return (
              <div key={b.id} className={cn("min-w-0", b.largo && "lg:col-span-2")}>
                {!d || "erro" in d ? <BlocoComErro titulo={b.titulo} icone={ICONES[b.id]} /> : renderizar(b.id, d as never)}
              </div>
            );
          })}
        </div>
      )}

      <FrivoIA />
    </div>
  );
}
