import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Panel from "@/components/Panel";
import SelfImproving from "@/components/SelfImproving";
import Protections from "@/components/Protections";
import Privacy from "@/components/Privacy";
import Ecosystem from "@/components/Ecosystem";
import Affiliate from "@/components/Affiliate";
import Cta from "@/components/Cta";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-bg">
      <Nav />
      <Hero />
      <Features />
      <HowItWorks />
      <Panel />
      <SelfImproving />
      <Protections />
      <Privacy />
      <Ecosystem />
      <Affiliate />
      <Cta />
      <Footer />
    </main>
  );
}
