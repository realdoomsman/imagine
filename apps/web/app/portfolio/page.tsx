import { PortfolioView } from "@/components/portfolio-view";

export const metadata = {
  title: "Portfolio",
  description: "Your locks, your weight, and what the fee stream owes you.",
};

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:py-20">
      <p className="rule-label">Portfolio</p>
      <h1 className="t-section mt-5">
        What the stream owes you
      </h1>
      <PortfolioView />
    </div>
  );
}
