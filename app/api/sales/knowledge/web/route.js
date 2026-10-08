import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { addDocument } from "@/libs/sales/knowledge/store";
import { fetchPageText } from "@/libs/sales/knowledge/extract";
import { knowledgeFail as fail } from "@/libs/sales/knowledge/http";

// POST /api/sales/knowledge/web { url, category, title? } — add the text of one public web page
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    let page;
    try {
      page = await fetchPageText(body.url);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const title = String(body.title || "").trim() || page.title || page.url;
    const document = await addDocument({ userId: user.id, title, category: body.category, content: page.text, kind: "web", source: page.url });
    return NextResponse.json({ success: true, document });
  } catch (error) {
    return fail(error, "Could not add the page");
  }
}, { requireUser: true });
