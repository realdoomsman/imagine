import { PortfolioView } from "@/components/portfolio-view";

export const metadata = {
  title: "Portfolio",
  description: "Your locks, your weight, and what the fee stream owes you.",
};

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10">
      <p className="rule-label">Portfolio</p>
      <h1 className="mt-3 text-[clamp(2rem,4vw,2.75rem)] leading-none">
        What the stream owes you
      </h1>
      <PortfolioView />
    </div>
  );
}
