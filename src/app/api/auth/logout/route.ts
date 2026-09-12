import { NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/auth";
export async function GET(request: Request) { const response = NextResponse.redirect(absoluteUrl("/login", request)); response.cookies.delete("halftone_session"); return response; }
