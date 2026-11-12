import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  if (session) redirect("/dashboard");
  redirect("/sessao-encerrada"); // limpa cookie antigo (se houver) e vai para o login
}
