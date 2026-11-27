import StudioClient from "./studio-client";

export default async function StudioPage({searchParams}:{searchParams:Promise<{lang?:string}>}) {
  const {lang}=await searchParams;
  return <StudioClient initialLang={lang==="ar"?"ar":"fr"}/>;
}
