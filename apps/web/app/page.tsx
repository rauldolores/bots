import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Integrations from "@/components/Integrations";
import HowItWorks from "@/components/HowItWorks";
import Voice from "@/components/Voice";
import Pricing from "@/components/Pricing";
import Industries from "@/components/Industries";
import Panel from "@/components/Panel";
import SelfImproving from "@/components/SelfImproving";
import Protections from "@/components/Protections";
import Privacy from "@/components/Privacy";
import Ecosystem from "@/components/Ecosystem";
import Affiliate from "@/components/Affiliate";
import Cta from "@/components/Cta";

// El encabezado (logo, menú, botón de registro) y el pie los pone
// app/layout.tsx, para que todas las páginas del sitio los compartan.
export default function Home() {
  return (
    <main className="min-h-screen bg-bg">
      <Hero />
      <Features />
      <Integrations />
      <HowItWorks />
      <Voice />
      <Pricing />
      <Industries />
      <Panel />
      <SelfImproving />
      <Protections />
      <Privacy />
      <Ecosystem />
      <Affiliate />
      <Cta />
    </main>
  );
}
