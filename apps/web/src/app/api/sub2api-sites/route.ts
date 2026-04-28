import { NextResponse } from "next/server";
import {
  createSub2ApiSite,
  listSub2ApiSites,
} from "@/lib/sub2api-sites/repository";

type Sub2ApiSiteRequestBody = {
  name?: unknown;
  api_url?: unknown;
  api_key?: unknown;
};

function validateSiteInput(body: Sub2ApiSiteRequestBody, requireApiKey: boolean) {
  if (!String(body.name || "").trim()) {
    return "Name is required";
  }
  if (!String(body.api_url || "").trim()) {
    return "API URL is required";
  }
  if (requireApiKey && !String(body.api_key || "").trim()) {
    return "API Key is required";
  }
  return null;
}

export async function GET() {
  try {
    const sites = await listSub2ApiSites();
    return NextResponse.json({ sites });
  } catch (error) {
    console.error("Failed to list sub2api sites:", error);
    return NextResponse.json(
      { error: "Failed to list sub2api sites" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validationError = validateSiteInput(body, true);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const site = await createSub2ApiSite(body);
    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    console.error("Failed to create sub2api site:", error);
    return NextResponse.json(
      { error: "Failed to create sub2api site" },
      { status: 500 }
    );
  }
}
