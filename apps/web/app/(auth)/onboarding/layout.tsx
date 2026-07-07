import { Source_Serif_4 } from "next/font/google";
import { cn } from "@multica/ui/lib/utils";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  fallback: [
    "ui-serif",
    "Iowan Old Style",
    "Apple Garamond",
    "Baskerville",
    "Times New Roman",
    "serif",
  ],
});

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={cn("h-full", sourceSerif.variable)}>{children}</div>;
}
