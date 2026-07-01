import { NextRequest, NextResponse } from "next/server";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  if (q.trim().length < 2) {
    return NextResponse.json(
      {
        original_query: q,
        search_query: q,
        language: "en",
        translated_query: "",
        translator: "none",
        expansions: [],
        fallback_terms: [],
      },
      { headers: corsHeaders }
    );
  }

  const result = await buildSmartSearchQuery(q);
  return NextResponse.json(result, { headers: corsHeaders });
}
