import { redirect } from "next/navigation";

// "Costos" pasó a ser "Órdenes". Redirect para links viejos.
export default function CostsRedirect() {
  redirect("/orders");
}
