import { redirect } from "next/navigation";
import { destinoDePrazos } from "@/lib/os/rota-prazos";

/** "/prazos" saiu do menu (era "Prazos e SLA"); o endereço continua valendo para quem tem o link guardado. */
export default async function PrazosRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(destinoDePrazos(await searchParams));
}
