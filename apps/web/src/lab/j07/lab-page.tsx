"use client";
// Not a public Next route. The isolated no-deploy CI copies this file into a temporary route.
import StudioClient from "@/app/studio/studio-client";
import GuestCheckoutLab from "@/lab/j07/guest-checkout";
export default function GuestLabPage(){return <StudioClient labReview={GuestCheckoutLab}/>;}
