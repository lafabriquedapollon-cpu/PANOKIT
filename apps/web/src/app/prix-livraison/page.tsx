import PriceReview from "./price-review";
export default async function PricePage({searchParams}:{searchParams:Promise<{lang?:string}>}){
 const {lang}=await searchParams;
 return <PriceReview lang={lang==="ar"?"ar":"fr"}/>;
}
