import type { Metadata } from "next";
import HomePage from "../home-page";
export const metadata: Metadata = { title: "PANOKIT | اللافتات والتواصل البصري", description: "اكتشف فئات منتجات PANOKIT القابلة للتخصيص." };
export default function Page() { return <HomePage language="ar" />; }
