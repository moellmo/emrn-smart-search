import { NextRequest, NextResponse } from "next/server";
import {
  defaultSearchOverrides,
  getRuntimeSearchOverrides,
  mergeSearchOverrides,
  saveRuntimeSearchOverrides,
  sanitizeSearchOverrides,
} from "../../../lib/search-overrides";
import { getReindexStatus } from "../../../lib/reindex-status";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-smartsearch-admin-password",
};

function isAuthorized(req: NextRequest) {
  const configuredPassword = process.env.SMARTSEARCH_ADMIN_PASSWORD;

  if (!configuredPassword) {
    return {
      ok: false,
      status: 500,
      message: "SMARTSEARCH_ADMIN_PASSWORD is not set in Vercel.",
    };
  }

  const suppliedPassword = req.headers.get("x-smartsearch-admin-password") || "";

  if (suppliedPassword !== configuredPassword) {
    return {
      ok: false,
      status: 401,
      message: "Invalid admin password.",
    };
  }

  return { ok: true, status: 200, message: "OK" };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status, headers: corsHeaders });
  }

  const runtime = await getRuntimeSearchOverrides();
  const reindexStatus = await getReindexStatus();

  return NextResponse.json(
    {
      runtime,
      defaults: defaultSearchOverrides,
      effective: mergeSearchOverrides(runtime),
      reindexStatus,
    },
    { headers: corsHeaders }
  );
}

export async function POST(req: NextRequest) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status, headers: corsHeaders });
  }

  const body = await req.json();
  const clean = sanitizeSearchOverrides(body?.runtime || body || {});
  const saved = await saveRuntimeSearchOverrides(clean);

  return NextResponse.json(
    {
      ok: true,
      runtime: saved,
      effective: mergeSearchOverrides(saved),
    },
    { headers: corsHeaders }
  );
}
